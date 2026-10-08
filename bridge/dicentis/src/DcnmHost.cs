// Hosts the DICENTIS DCNM API (or the fake) and serves it generically through reflection (WO-078, DEC-021).
// Protocol: docs/protocol/dcnm-api/BRIDGE.md. Interfaces are discovered from WindowsApiInstance's properties; documented
// interfaces without a property are found on objects that implement them. Members are always reached through the
// interface types (implementations may be explicit or obfuscated).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using BridgeCore;

namespace DicentisBridge
{
    public sealed class DcnmInterface
    {
        public string Key;            // ControlSpeaker, RoomAudioControl, #3 (handle)
        public Type Interface;        // IControlSpeaker
        public object Instance;
        public string Source;         // property | implemented by <key> | handle
        public readonly Dictionary<string, List<MethodInfo>> Methods = new Dictionary<string, List<MethodInfo>>(StringComparer.Ordinal);
        public readonly List<EventInfo> Events = new List<EventInfo>();
        public readonly Dictionary<string, PropertyInfo> Properties = new Dictionary<string, PropertyInfo>(StringComparer.Ordinal);
    }

    public sealed class DcnmHost : IBridgeHost
    {
        public const string ApiDll = "Bosch.Dcnm.Interfaces.Api.dll";
        public const string EntryType = "Bosch.Dcnm.Interfaces.Api.WindowsApiInstance";
        public const string StandardInstallDir = @"Bosch\DICENTIS";
        const int DefaultTimeoutMs = 30000;

        public readonly Dictionary<string, DcnmInterface> Interfaces = new Dictionary<string, DcnmInterface>(StringComparer.Ordinal);
        public readonly List<string> Warnings = new List<string>();
        public readonly string ApiVersion;
        public readonly string DllPath;
        public readonly bool Fake;
        public readonly Type Entry;

        public event Action<Dictionary<string, object>> Push;
        public string Name => "dicentis-bridge";

        readonly object entryInstance;
        readonly Log log;
        readonly ConcurrentDictionary<string, SemaphoreSlim> methodLocks = new ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.Ordinal);
        readonly SemaphoreSlim connectLock = new SemaphoreSlim(1, 1);
        readonly object statusGate = new object();
        readonly ConcurrentDictionary<string, DcnmInterface> handles = new ConcurrentDictionary<string, DcnmInterface>(StringComparer.Ordinal);
        readonly HashSet<string> subscribed = new HashSet<string>(StringComparer.Ordinal);
        readonly ConcurrentDictionary<long, TaskCompletionSource<object>> callbacks = new ConcurrentDictionary<long, TaskCompletionSource<object>>();
        int nextHandle;
        long nextCallback;
        long statusSeq;
        Timer statusTimer;
        string lastStatus = "";

        public DcnmHost(Type entry, bool fake, string dllPath, Log log, IEnumerable<string> documentedOther = null)
        {
            this.log = log;
            Entry = entry;
            Fake = fake;
            DllPath = dllPath;
            entryInstance = entry.IsAbstract && entry.IsSealed ? null : Activator.CreateInstance(entry);
            foreach (var p in entry.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static))
            {
                if (!p.PropertyType.IsInterface || p.GetIndexParameters().Length > 0) continue;
                object value;
                try { value = p.GetValue(p.GetGetMethod().IsStatic ? null : entryInstance, null); }
                catch (Exception ex) { Warn($"{p.Name}: getter threw {(ex.InnerException ?? ex).Message}"); continue; }
                if (value == null) { Warn($"{p.Name}: returned null"); continue; }
                Register(p.Name, p.PropertyType, value, "property");
            }
            if (Interfaces.Count == 0) throw new InvalidOperationException(entry.FullName + " exposes no interface properties");
            ApiVersion = Interfaces.Values.First().Interface.Assembly.GetName().Version?.ToString() ?? "";

            // Documented interfaces without a property of their own (IRoomAudioControl, IControlCamera, …): look for an
            // object we already have that implements them.
            var assemblies = Interfaces.Values.Select(i => i.Interface.Assembly).Distinct().ToArray();
            var candidates = assemblies.SelectMany(PublicTypes).Where(t => t.IsInterface && Interfaces.Values.All(i => i.Interface != t));
            if (documentedOther != null)
            {
                var wanted = new HashSet<string>(documentedOther, StringComparer.Ordinal);
                candidates = candidates.Where(t => wanted.Contains(t.Name));
            }
            foreach (var iface in candidates.ToList())
            {
                var holder = Interfaces.Values.FirstOrDefault(i => i.Source == "property" && iface.IsInstanceOfType(i.Instance));
                if (holder == null) continue;
                var key = iface.Name.StartsWith("I", StringComparison.Ordinal) ? iface.Name.Substring(1) : iface.Name;
                if (Interfaces.ContainsKey(key)) key = iface.Name;
                Register(key, iface, holder.Instance, "implemented by " + holder.Key);
            }
            // The API raises the current state on the first request only to registered handlers: subscribe everything now.
            foreach (var i in Interfaces.Values.ToList()) Subscribe(i);
        }

        void Warn(string message) { Warnings.Add(message); log.Warn(message); }

        static IEnumerable<Type> PublicTypes(Assembly a)
        {
            try { return a.GetExportedTypes(); }
            catch (ReflectionTypeLoadException ex) { return ex.Types.Where(t => t != null && t.IsPublic); }
            catch (NotSupportedException) { return Type.EmptyTypes; }
        }

        DcnmInterface Register(string key, Type iface, object instance, string source)
        {
            var d = new DcnmInterface { Key = key, Interface = iface, Instance = instance, Source = source };
            foreach (var t in AllInterfaces(iface))
            {
                if (t == typeof(IDisposable)) continue;
                foreach (var m in t.GetMethods())
                {
                    if (m.IsSpecialName) continue; // property/event accessors
                    if (!d.Methods.TryGetValue(m.Name, out var list)) d.Methods[m.Name] = list = new List<MethodInfo>();
                    list.Add(m);
                }
                d.Events.AddRange(t.GetEvents());
                foreach (var p in t.GetProperties())
                    if (p.GetIndexParameters().Length == 0 && !d.Properties.ContainsKey(p.Name)) d.Properties[p.Name] = p;
            }
            if (!key.StartsWith("#", StringComparison.Ordinal)) Interfaces[key] = d;
            return d;
        }

        /// <summary>The interface and everything it inherits, walked recursively.</summary>
        static Type[] AllInterfaces(Type t)
        {
            var seen = new List<Type>();
            void Walk(Type x) { if (seen.Contains(x)) return; seen.Add(x); foreach (var i in x.GetInterfaces()) Walk(i); }
            Walk(t);
            return seen.ToArray();
        }

        // ------------------------------------------------------------------ loading

        /// <summary>The DICENTIS installation folder when no --dll-dir is given: next to the exe, Program Files\Bosch\DICENTIS,
        /// or the first folder below Program Files\Bosch that contains the API DLL.</summary>
        public static string FindDllDir(Log log)
        {
            var programFiles = new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 }
                .Select(Environment.GetFolderPath).Where(p => p.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var candidates = new[] { AppDomain.CurrentDomain.BaseDirectory }.Concat(programFiles.Select(p => Path.Combine(p, StandardInstallDir)));
            var found = candidates.FirstOrDefault(d => File.Exists(Path.Combine(d, ApiDll)))
                ?? programFiles.Select(p => Search(Path.Combine(p, "Bosch"), 4)).FirstOrDefault(d => d != null);
            if (found == null)
                throw new FileNotFoundException("DICENTIS API (" + ApiDll + ") not found next to dicentis-bridge.exe, in "
                    + string.Join(" or ", programFiles.Select(p => Path.Combine(p, StandardInstallDir)))
                    + " or below Program Files\\Bosch. Install the DICENTIS software or pass its folder with --dll-dir \"<folder>\".");
            log.Info("DICENTIS API found in " + found);
            return found;
        }

        static string Search(string dir, int depth)
        {
            if (!Directory.Exists(dir)) return null;
            if (File.Exists(Path.Combine(dir, ApiDll))) return dir;
            if (depth == 0) return null;
            try { return Directory.GetDirectories(dir).Select(d => Search(d, depth - 1)).FirstOrDefault(d => d != null); }
            catch (Exception e) when (e is UnauthorizedAccessException || e is IOException) { return null; }
        }

        public static DcnmHost LoadReal(string dllDir, Log log, IEnumerable<string> documentedOther)
        {
            var dir = Path.GetFullPath(dllDir);
            var dll = Path.Combine(dir, ApiDll);
            if (!File.Exists(dll)) throw new FileNotFoundException("DICENTIS API not found: " + dll + " (--dll-dir must be the DICENTIS installation folder, e.g. \"C:\\Program Files\\" + StandardInstallDir + "\")");
            // Bosch libraries may load configuration files by relative path, as for Bosch's own applications.
            Environment.CurrentDirectory = dir;
            AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
            {
                var file = Path.Combine(dir, new AssemblyName(e.Name).Name + ".dll");
                return File.Exists(file) ? Assembly.LoadFrom(file) : null;
            };
            var asm = Assembly.LoadFrom(dll);
            var missing = MissingReferences(asm, dir).ToList();
            var host = new DcnmHost(asm.GetType(EntryType, true), false, dll, log, documentedOther);
            foreach (var m in missing) host.Warn(m);
            return host;
        }

        public static DcnmHost LoadFake(Log log, IEnumerable<string> documentedOther) => new DcnmHost(typeof(Fake.WindowsApiInstance), true, null, log, documentedOther);

        static IEnumerable<string> MissingReferences(Assembly root, string dir)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var todo = new Stack<Assembly>(new[] { root });
            while (todo.Count > 0)
            {
                foreach (var r in todo.Pop().GetReferencedAssemblies())
                {
                    if (!seen.Add(r.Name) || r.Name.StartsWith("System", StringComparison.Ordinal) || r.Name == "mscorlib" || r.Name == "netstandard" || r.Name.StartsWith("Microsoft", StringComparison.Ordinal)) continue;
                    var file = new[] { ".dll", ".DLL", ".exe" }.Select(ext => Path.Combine(dir, r.Name + ext)).FirstOrDefault(File.Exists);
                    if (file == null) { yield return "referenced assembly not found in the DLL folder: " + r.FullName; continue; }
                    Assembly loaded = null;
                    string error = null;
                    try { loaded = Assembly.LoadFrom(file); } catch (Exception ex) { error = "cannot load " + file + ": " + ex.Message; }
                    if (error != null) yield return error; else todo.Push(loaded);
                }
            }
        }

        // ------------------------------------------------------------------ events and status

        void Subscribe(DcnmInterface d)
        {
            foreach (var ev in d.Events)
            {
                var id = d.Key + "." + ev.Name;
                lock (subscribed) if (!subscribed.Add(id)) continue;
                try { ev.AddEventHandler(d.Instance, BuildHandler(ev.EventHandlerType, d.Key, ev.Name)); }
                catch (Exception ex) { Warn($"{id}: cannot subscribe: {(ex.InnerException ?? ex).Message}"); }
            }
        }

        Delegate BuildHandler(Type handlerType, string key, string name)
        {
            var invoke = handlerType.GetMethod("Invoke");
            var ps = invoke.GetParameters().Select(p => Expression.Parameter(p.ParameterType, p.Name)).ToArray();
            Expression args = ps.Length > 1 ? (Expression)Expression.Convert(ps[1], typeof(object)) : Expression.Constant(null, typeof(object));
            var sink = typeof(DcnmHost).GetMethod(nameof(Sink), BindingFlags.NonPublic | BindingFlags.Instance);
            var body = Expression.Call(Expression.Constant(this), sink, Expression.Constant(key), Expression.Constant(name), args);
            return Expression.Lambda(handlerType, body, ps).Compile();
        }

        void Sink(string key, string name, object args)
        {
            try
            {
                Push?.Invoke(new Dictionary<string, object>
                {
                    ["type"] = "event", ["api"] = key, ["event"] = name,
                    ["args"] = ClrConvert.FromClr(args) ?? new Dictionary<string, object>(), ["time"] = DateTime.UtcNow.ToString("o"),
                });
                if (name == "CapabilitiesChanged" || name.EndsWith("StateChanged", StringComparison.Ordinal)) ScheduleStatus();
            }
            catch (Exception ex) { log.Error($"event {key}.{name}: {ex.Message}"); } // never throw into the API's thread
        }

        /// <summary>Re-read the status 250 ms after the last trigger and push it when it changed (no polling, see BRIDGE.md).</summary>
        void ScheduleStatus()
        {
            lock (statusGate)
            {
                if (statusTimer == null) statusTimer = new Timer(_ => PushStatusIfChanged(), null, 250, Timeout.Infinite);
                else statusTimer.Change(250, Timeout.Infinite);
            }
        }

        void PushStatusIfChanged()
        {
            try
            {
                var status = Status();
                var text = Json.Write(status);
                lock (statusGate) { if (text == lastStatus) return; lastStatus = text; }
                Push?.Invoke(new Dictionary<string, object> { ["type"] = "status", ["status"] = status });
            }
            catch (Exception ex) { log.Error("status: " + ex.Message); }
        }

        object Read(string key, string property)
        {
            if (!Interfaces.TryGetValue(key, out var d) || !d.Properties.TryGetValue(property, out var p)) return null;
            try { return p.GetValue(d.Instance, null); }
            catch { return null; }
        }

        public Dictionary<string, object> Status()
        {
            var interfaces = new Dictionary<string, object>();
            foreach (var d in Interfaces.Values)
            {
                var values = new Dictionary<string, object>();
                foreach (var p in d.Properties.Values)
                {
                    if (!p.CanRead || !ClrConvert.IsScalar(p.PropertyType)) continue;
                    try { values[p.Name] = ClrConvert.FromClr(p.GetValue(d.Instance, null)); }
                    catch { /* not available in this state */ }
                }
                interfaces[d.Key] = values;
            }
            // seq: requests run concurrently, so a status computed earlier can reach the client after a newer one; the client
            // ignores a status with a lower seq than the last it saw.
            return new Dictionary<string, object> { ["seq"] = Interlocked.Increment(ref statusSeq), ["connection"] = Connection(), ["interfaces"] = interfaces };
        }

        Dictionary<string, object> Connection()
        {
            var device = Read("Device", "CurrentDeviceConnectionState");
            return new Dictionary<string, object>
            {
                ["open"] = Read("Base", "IsOpen") as bool? ?? false,
                ["authenticated"] = Read("Base", "IsUserLoggedOn") as bool? ?? false,
                ["device"] = device == null ? null : ClrConvert.FromClr(device),
                ["enabled"] = Read("Device", "IsEnabledAsDevice") as bool?,
                ["apiState"] = ClrConvert.FromClr(Read("Base", "CurrentApiState")),
            };
        }

        /// <summary>const fields of the API's classes, e.g. "DcnmMicrophoneOptions.DEFAULT_OPEN_MICROPHONES": 2.</summary>
        public Dictionary<string, object> Constants()
        {
            var result = new Dictionary<string, object>();
            var ns = Interfaces.Values.First(i => i.Source == "property").Interface.Namespace;
            foreach (var t in Interfaces.Values.Select(i => i.Interface.Assembly).Distinct().SelectMany(PublicTypes).Where(t => t.Namespace == ns && !t.IsInterface && !t.IsEnum))
                foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.Static))
                {
                    if (!(f.IsLiteral || f.IsInitOnly)) continue;
                    var v = f.IsLiteral ? f.GetRawConstantValue() : f.GetValue(null);
                    if (v == null || v is string || v.GetType().IsPrimitive || v.GetType().IsEnum) result[t.Name + "." + f.Name] = ClrConvert.FromClr(v);
                }
            return result;
        }

        // ------------------------------------------------------------------ IBridgeHost

        public Dictionary<string, object> BridgeInfo() => new Dictionary<string, object>
        {
            ["apiVersion"] = ApiVersion, ["fake"] = Fake, ["dllPath"] = DllPath, ["is64Bit"] = Environment.Is64BitProcess,
        };

        public Task<Dictionary<string, object>> HelloExtras() => Task.FromResult(new Dictionary<string, object>
        {
            ["interfaces"] = Interfaces.Values.ToDictionary(i => i.Key, i => (object)new Dictionary<string, object> { ["interface"] = i.Interface.Name, ["source"] = i.Source }),
            ["constants"] = Constants(),
            ["status"] = Status(),
        });

        public Task<object> Handle(string type, Dictionary<string, object> msg)
        {
            switch (type)
            {
                case "status": return Task.FromResult<object>(Status());
                case "connect": return ConnectAsync(msg);
                case "disconnect": return DisconnectAsync();
                case "call": return CallAsync(msg);
                case "get": return Task.FromResult(GetProperty(msg));
                case "set": return Task.FromResult(SetProperty(msg));
                case "callbackResult":
                {
                    var id = msg.TryGetValue("callback", out var c) && c is long l ? l : throw new BridgeError("BAD_REQUEST", "missing integer field 'callback'");
                    if (!callbacks.TryRemove(id, out var tcs)) throw new BridgeError("BAD_REQUEST", "no pending callback " + id + " (answered already or timed out)");
                    msg.TryGetValue("result", out var result);
                    tcs.TrySetResult(result);
                    return Task.FromResult<object>(new Dictionary<string, object>());
                }
                case "release":
                {
                    var h = BridgeServer.Str(msg, "handle");
                    if (!handles.TryRemove(h, out _)) throw new BridgeError("UNKNOWN_HANDLE", "no handle " + h);
                    return Task.FromResult<object>(new Dictionary<string, object>());
                }
                default: throw new BridgeError("BAD_REQUEST", "unknown type " + (type ?? "(none)"));
            }
        }

        DcnmInterface Find(string key)
        {
            if (key.StartsWith("#", StringComparison.Ordinal))
                return handles.TryGetValue(key, out var h) ? h : throw new BridgeError("UNKNOWN_HANDLE", "no handle " + key);
            return Interfaces.TryGetValue(key, out var d) ? d : throw new BridgeError("UNKNOWN_API", "no interface " + key + " (known: " + string.Join(", ", Interfaces.Keys) + ")");
        }

        static int TimeoutOf(Dictionary<string, object> msg) =>
            msg.TryGetValue("timeoutMs", out var t) && t is long ms && ms > 0 ? (int)Math.Min(ms, int.MaxValue) : DefaultTimeoutMs;

        // ------------------------------------------------------------------ properties

        object GetProperty(Dictionary<string, object> msg)
        {
            var d = Find(BridgeServer.Str(msg, "api"));
            var name = BridgeServer.Str(msg, "property");
            if (!d.Properties.TryGetValue(name, out var p) || !p.CanRead) throw new BridgeError("UNKNOWN_PROPERTY", d.Key + "." + name + ": no readable property");
            try { return new Dictionary<string, object> { ["value"] = ClrConvert.FromClr(p.GetValue(d.Instance, null)) }; }
            catch (TargetInvocationException ex) { throw new ApiCallException(ex.InnerException ?? ex); }
        }

        object SetProperty(Dictionary<string, object> msg)
        {
            var d = Find(BridgeServer.Str(msg, "api"));
            var name = BridgeServer.Str(msg, "property");
            if (!d.Properties.TryGetValue(name, out var p) || !p.CanWrite) throw new BridgeError("UNKNOWN_PROPERTY", d.Key + "." + name + ": no writable property");
            msg.TryGetValue("value", out var json);
            var value = ClrConvert.ToClr(json, p.PropertyType, name);
            try { p.SetValue(d.Instance, value, null); }
            catch (TargetInvocationException ex) { throw new ApiCallException(ex.InnerException ?? ex); }
            ScheduleStatus();
            return new Dictionary<string, object>();
        }

        // ------------------------------------------------------------------ calls

        static bool IsCallback(ParameterInfo p) =>
            p.ParameterType.IsGenericType && p.ParameterType.GetGenericTypeDefinition() == typeof(Action<>) && typeof(Task).IsAssignableFrom(p.ParameterType.GetGenericArguments()[0])
            || p.ParameterType == typeof(Action<Task>);

        /// <summary>Parameters the client does not pass: onFinish, CancellationToken, and delegates (the bridge supplies them).</summary>
        static bool IsHidden(ParameterInfo p) => IsCallback(p) || p.ParameterType == typeof(CancellationToken) || typeof(Delegate).IsAssignableFrom(p.ParameterType);

        /// <summary>
        /// A delegate argument (e.g. PluginEventDelegate, PluginCommandDelegate): when the API invokes it, the bridge pushes
        /// {type:"callback", callback, api, method, parameter, args}. For a void delegate that is all; for one returning a
        /// value or Task&lt;T&gt; the bridge waits for the client's {type:"callbackResult", callback, result} (timeout → default).
        /// </summary>
        Delegate BuildCallback(Type delegateType, string key, string method, string parameter, int timeout)
        {
            var invoke = delegateType.GetMethod("Invoke");
            var ps = invoke.GetParameters().Select(p => Expression.Parameter(p.ParameterType, p.Name)).ToArray();
            var names = Expression.Constant(ps.Select(p => p.Name).ToArray());
            var values = Expression.NewArrayInit(typeof(object), ps.Select(p => Expression.Convert(p, typeof(object))));
            var call = Expression.Call(Expression.Constant(this), typeof(DcnmHost).GetMethod(nameof(Callback), BindingFlags.NonPublic | BindingFlags.Instance),
                Expression.Constant(key), Expression.Constant(method), Expression.Constant(parameter), names, values,
                Expression.Constant(invoke.ReturnType == typeof(void) ? 0 : timeout));
            Expression body;
            var ret = invoke.ReturnType;
            if (ret == typeof(void)) body = call;
            else if (ret.IsGenericType && ret.GetGenericTypeDefinition() == typeof(Task<>))
                body = Expression.Call(typeof(DcnmHost).GetMethod(nameof(Typed), BindingFlags.NonPublic | BindingFlags.Static).MakeGenericMethod(ret.GetGenericArguments()[0]), call);
            else if (ret == typeof(Task)) body = Expression.Convert(call, typeof(Task));
            else body = Expression.Call(typeof(DcnmHost).GetMethod(nameof(Blocking), BindingFlags.NonPublic | BindingFlags.Static).MakeGenericMethod(ret), call);
            return Expression.Lambda(delegateType, body, ps).Compile();
        }

        /// <summary>Push a callback; for a value-returning delegate, a task that completes with the client's answer.</summary>
        Task<object> Callback(string key, string method, string parameter, string[] names, object[] values, int timeout)
        {
            var id = Interlocked.Increment(ref nextCallback);
            var args = new Dictionary<string, object>();
            for (var i = 0; i < names.Length; i++) if (!(values[i] is CancellationToken)) args[names[i]] = ClrConvert.FromClr(values[i]);
            TaskCompletionSource<object> tcs = null;
            if (timeout > 0)
            {
                tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
                callbacks[id] = tcs;
                Task.Delay(timeout).ContinueWith(_ => { if (callbacks.TryRemove(id, out var late)) late.TrySetResult(null); });
            }
            Push?.Invoke(new Dictionary<string, object>
            {
                ["type"] = "callback", ["callback"] = id, ["api"] = key, ["method"] = method, ["parameter"] = parameter,
                ["args"] = args, ["expectsResult"] = tcs != null, ["time"] = DateTime.UtcNow.ToString("o"),
            });
            return tcs?.Task ?? Task.FromResult<object>(null);
        }

        static Task<T> Typed<T>(Task<object> answer) =>
            answer.ContinueWith(t => t.Result == null ? default(T) : (T)ClrConvert.ToClr(t.Result, typeof(T), "result"), TaskScheduler.Default);

        static T Blocking<T>(Task<object> answer) => Typed<T>(answer).GetAwaiter().GetResult();

        static string Signature(MethodInfo m) => m.Name + "(" + string.Join(", ", m.GetParameters().Where(p => !IsHidden(p)).Select(p => p.Name + (p.IsOptional ? "?" : ""))) + ")";

        /// <summary>The overload that takes every given argument and gets all its required ones; the smallest such.</summary>
        static MethodInfo Choose(DcnmInterface d, string method, ICollection<string> given)
        {
            if (!d.Methods.TryGetValue(method, out var overloads)) throw new BridgeError("UNKNOWN_METHOD", "no method " + d.Key + "." + method);
            var match = overloads
                .Select(m => new { m, visible = m.GetParameters().Where(p => !IsHidden(p)).ToList() })
                .Where(x => given.All(g => x.visible.Any(p => p.Name == g)) && x.visible.All(p => p.IsOptional || given.Contains(p.Name)))
                .OrderBy(x => x.visible.Count)
                .FirstOrDefault();
            if (match == null)
                throw new BadArgsException($"{d.Key}.{method}: no overload takes ({string.Join(", ", given)}); overloads: {string.Join(" | ", overloads.Select(Signature))}");
            return match.m;
        }

        async Task<object> CallAsync(Dictionary<string, object> msg)
        {
            var d = Find(BridgeServer.Str(msg, "api"));
            var name = BridgeServer.Str(msg, "method");
            var args = msg.TryGetValue("args", out var a) ? a as Dictionary<string, object> : null;
            if (a != null && args == null) throw new BridgeError("BAD_REQUEST", "args must be an object");
            args = args ?? new Dictionary<string, object>();
            var timeout = TimeoutOf(msg);
            var m = Choose(d, name, args.Keys);
            var ps = m.GetParameters();
            var values = new object[ps.Length];
            using (var cts = new CancellationTokenSource(timeout))
            {
                for (var i = 0; i < ps.Length; i++)
                {
                    var p = ps[i];
                    if (IsCallback(p)) values[i] = null;
                    else if (p.ParameterType == typeof(CancellationToken)) values[i] = cts.Token;
                    else if (p.ParameterType == typeof(SynchronizationContext)) throw new BadArgsException(p.Name + ": a SynchronizationContext cannot be passed over the bridge");
                    else if (p.IsOut) values[i] = null;
                    else if (typeof(Delegate).IsAssignableFrom(p.ParameterType)) values[i] = BuildCallback(p.ParameterType, d.Key, m.Name, p.Name, timeout);
                    else if (p.ParameterType.IsInterface && args.TryGetValue(p.Name, out var hj) && hj is Dictionary<string, object> href && href.TryGetValue("$handle", out var hid))
                        values[i] = handles.TryGetValue(hid as string ?? "", out var hd) && p.ParameterType.IsInstanceOfType(hd.Instance) ? hd.Instance : throw new BridgeError("UNKNOWN_HANDLE", p.Name + ": no handle " + hid);
                    else if (args.TryGetValue(p.Name, out var json)) values[i] = ClrConvert.ToClr(json, p.ParameterType, p.Name);
                    else values[i] = p.DefaultValue is DBNull || p.DefaultValue == Missing.Value ? ClrConvert.DefaultFor(p.ParameterType) : p.DefaultValue;
                }
                // The API refuses re-entering a function before the previous call released it: one call per method at a time.
                var gate = methodLocks.GetOrAdd(d.Key + "." + m.Name, _ => new SemaphoreSlim(1, 1));
                if (!await gate.WaitAsync(timeout).ConfigureAwait(false)) throw new BridgeError("TIMEOUT", $"{d.Key}.{m.Name}: an earlier call did not finish within {timeout} ms");
                try
                {
                    object returned;
                    try { returned = m.Invoke(d.Instance, values); }
                    catch (TargetInvocationException ex) { throw new ApiCallException(ex.InnerException ?? ex); }
                    log.Debug($"{d.Key}.{m.Name} called");
                    var resultType = m.ReturnType;
                    object value = returned;
                    if (returned is Task task)
                    {
                        if (await Task.WhenAny(task, Task.Delay(timeout)).ConfigureAwait(false) != task)
                            throw new BridgeError("TIMEOUT", $"{d.Key}.{m.Name} did not finish within {timeout} ms");
                        if (task.IsFaulted) throw new ApiCallException(Unwrap(task.Exception));
                        if (task.IsCanceled) throw new BridgeError("TIMEOUT", $"{d.Key}.{m.Name} was cancelled");
                        if (resultType.IsGenericType && resultType.GetGenericTypeDefinition() == typeof(Task<>))
                        {
                            resultType = resultType.GetGenericArguments()[0];
                            value = typeof(Task<>).MakeGenericType(resultType).GetProperty("Result").GetValue(task, null);
                        }
                        else { resultType = typeof(void); value = null; }
                    }
                    var outs = ps.Where(p => p.ParameterType.IsByRef).ToDictionary(p => p.Name, p => ClrConvert.FromClr(values[p.Position]));
                    var result = new Dictionary<string, object> { ["result"] = resultType == typeof(void) ? null : Encode(value, resultType) };
                    if (outs.Count > 0) result["out"] = outs;
                    return result;
                }
                finally { gate.Release(); }
            }
        }

        static Exception Unwrap(Exception ex)
        {
            while (ex is AggregateException ag && ag.InnerExceptions.Count == 1) ex = ag.InnerException;
            return ex;
        }

        /// <summary>A result whose declared type is an interface (not a collection) becomes a handle.</summary>
        object Encode(object value, Type declared)
        {
            if (value != null && declared.IsInterface && !typeof(System.Collections.IEnumerable).IsAssignableFrom(declared))
            {
                var id = "#" + Interlocked.Increment(ref nextHandle);
                var d = Register(id, declared, value, "handle");
                handles[id] = d;
                Subscribe(d);
                return new Dictionary<string, object> { ["$handle"] = id, ["interface"] = declared.Name };
            }
            return ClrConvert.FromClr(value);
        }

        // ------------------------------------------------------------------ connect / disconnect

        async Task<object> Invoke(string key, string method, int timeout, params (string name, object value)[] args)
        {
            var msg = new Dictionary<string, object>
            {
                ["api"] = key, ["method"] = method, ["timeoutMs"] = (long)timeout,
                ["args"] = args.ToDictionary(a => a.name, a => a.value),
            };
            var r = (Dictionary<string, object>)await CallAsync(msg).ConfigureAwait(false);
            return r["result"];
        }

        async Task WaitFor(Func<bool> condition, int timeout, string step)
        {
            var end = DateTime.UtcNow.AddMilliseconds(timeout);
            while (!condition())
            {
                if (DateTime.UtcNow > end) throw new BridgeError("TIMEOUT", "connect: " + step + " not reached within " + timeout + " ms");
                await Task.Delay(100).ConfigureAwait(false);
            }
        }

        bool Flag(string key, string property) => Read(key, property) as bool? ?? false;
        string State(string key, string property) => Read(key, property)?.ToString();

        async Task<object> ConnectAsync(Dictionary<string, object> msg)
        {
            var user = msg.TryGetValue("user", out var u) ? u as string : null;
            var password = msg.TryGetValue("password", out var pw) ? pw as string ?? "" : "";
            var server = msg.TryGetValue("server", out var s) ? s as string : null;
            var device = msg.TryGetValue("device", out var dv) ? dv as string : null;
            var timeout = TimeoutOf(msg);
            if (!Interfaces.ContainsKey("Base")) throw new BridgeError("UNKNOWN_API", "the API has no Base (IApi) interface");
            await connectLock.WaitAsync().ConfigureAwait(false);
            try
            {
                if (!Flag("Base", "IsOpen"))
                {
                    log.Info("Base.OpenAsync(" + (string.IsNullOrEmpty(server) ? "" : server) + ")");
                    if (string.IsNullOrEmpty(server)) await Invoke("Base", "OpenAsync", timeout).ConfigureAwait(false);
                    else await Invoke("Base", "OpenAsync", timeout, ("hostNameOrAddress", server)).ConfigureAwait(false);
                    await WaitFor(() => Flag("Base", "IsOpen"), timeout, "Base.IsOpen").ConfigureAwait(false);
                }
                var authenticated = Flag("Base", "IsUserLoggedOn");
                if (!authenticated && !string.IsNullOrEmpty(user))
                {
                    await WaitFor(() => Flag("Base", "CanAuthenticate"), timeout, "Base.CanAuthenticate").ConfigureAwait(false);
                    log.Info("Base.AuthenticateUserAsync(" + user + ")");
                    authenticated = await Invoke("Base", "AuthenticateUserAsync", timeout, ("userName", user), ("password", password)).ConfigureAwait(false) as bool? == true
                        || Flag("Base", "IsUserLoggedOn");
                    if (!authenticated) log.Warn("authentication failed for " + user);
                }
                if (authenticated && !string.IsNullOrEmpty(device) && Interfaces.ContainsKey("Device"))
                {
                    if (State("Device", "CurrentDeviceConnectionState") != "Connected")
                    {
                        await WaitFor(() => Flag("Device", "CanConnectAsDevice"), timeout, "Device.CanConnectAsDevice").ConfigureAwait(false);
                        log.Info("Device.ConnectAsDeviceAsync(" + device + ")");
                        await Invoke("Device", "ConnectAsDeviceAsync", timeout, ("uniqueId", device)).ConfigureAwait(false);
                        await WaitFor(() => State("Device", "CurrentDeviceConnectionState") == "Connected", timeout, "Device connected").ConfigureAwait(false);
                    }
                    if (!Flag("Device", "IsEnabledAsDevice"))
                        log.Warn($"connected as device '{device}' but not enabled: assign it to a seat with manage rights in DICENTIS");
                }
                ScheduleStatus();
                var c = Connection();
                c["authenticated"] = authenticated;
                return c;
            }
            finally { connectLock.Release(); }
        }

        async Task<object> DisconnectAsync()
        {
            await connectLock.WaitAsync().ConfigureAwait(false);
            try
            {
                if (Interfaces.ContainsKey("Device") && State("Device", "CurrentDeviceConnectionState") == "Connected")
                    await Try(() => Invoke("Device", "DisconnectAsDeviceAsync", DefaultTimeoutMs)).ConfigureAwait(false);
                if (Flag("Base", "IsUserLoggedOn")) await Try(() => Invoke("Base", "RevokeUserAsync", DefaultTimeoutMs)).ConfigureAwait(false);
                if (Flag("Base", "IsOpen")) await Try(() => Invoke("Base", "CloseAsync", DefaultTimeoutMs)).ConfigureAwait(false);
                ScheduleStatus();
                return new Dictionary<string, object>();
            }
            finally { connectLock.Release(); }
        }

        async Task Try(Func<Task<object>> step)
        {
            try { await step().ConfigureAwait(false); }
            catch (Exception ex) { log.Warn("disconnect: " + ex.Message); }
        }

        /// <summary>WindowsApiInstance.Shutdown() on exit ("Closes the api").</summary>
        public void Shutdown()
        {
            try
            {
                var shutdown = Entry.GetMethod("Shutdown", Type.EmptyTypes);
                if (shutdown != null) shutdown.Invoke(shutdown.IsStatic ? null : entryInstance, null);
                (entryInstance as IDisposable)?.Dispose();
            }
            catch (Exception ex) { log.Warn("shutdown: " + (ex.InnerException ?? ex).Message); }
        }
    }
}
