// Hosts the DCN-SW API (or the fake) and exposes it generically through reflection (WO-061, DEC-017).
// Everything is discovered from the *interfaces* (IControlApi/IConfigApi and their sub-interface properties), because
// the obfuscated implementation classes may implement them explicitly.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Threading;
using BridgeCore;

namespace DcnBridge
{
    public sealed class ApiInterface
    {
        public string Key;            // e.g. control.DiscussionApi
        public PropertyInfo Property; // on the root interface
        public Type Interface;
        public object Instance;       // resolved after Initialize
        public Dictionary<string, MethodInfo> Methods = new Dictionary<string, MethodInfo>(StringComparer.Ordinal);
        public List<EventInfo> Events = new List<EventInfo>();
        public List<PropertyInfo> Flags = new List<PropertyInfo>();
        public bool Subscribed;
    }

    public sealed class ApiRoot
    {
        public string Group;          // control | config
        public object Instance;       // DcnApi.ControlApi
        public Type Interface;        // IControlApi
        public MethodInfo Initialize, Terminate;
        public PropertyInfo IsAvailable;
        public List<PropertyInfo> Flags = new List<PropertyInfo>();
        public Dictionary<string, ApiInterface> Subs = new Dictionary<string, ApiInterface>(StringComparer.Ordinal);
        public bool Initialized;
        public string InitKey;
    }

    public sealed class ApiHost
    {
        public const string LogicDll = "Bosch.Dcn.Ecpc.Client.Api.Logic.dll";
        public const string EntryType = "Bosch.Dcn.Ecpc.Client.Api.Logic.DcnApi";
        /// <summary>Remoting channel config that Bosch.Dcn.Ecpc.Client.Logic loads by bare file name, i.e. from the working
        /// directory (WO-068): tcp channel port 0 + typeFilterLevel Full, needed for the server's event callbacks.</summary>
        public const string RemotingConfig = "Bosch.Dcn.Ecpc.Client.Logic.dll.config";

        /// <summary>Problems found while loading the real DLLs (shown by --selftest and logged at start).</summary>
        public readonly List<string> Warnings = new List<string>();

        public readonly Dictionary<string, ApiRoot> Roots = new Dictionary<string, ApiRoot>(StringComparer.Ordinal);
        public readonly Dictionary<string, ApiInterface> Interfaces = new Dictionary<string, ApiInterface>(StringComparer.Ordinal);
        public readonly string ApiVersion;
        public readonly string DllPath;
        public readonly bool Fake;
        public TimeSpan InitTimeout = TimeSpan.FromSeconds(60);

        /// <summary>(api key, event name, JSON-ready args)</summary>
        public event Action<string, string, object> ApiEvent;
        /// <summary>Availability or authorization changed on a root.</summary>
        public event Action StatusChanged;

        readonly Log log;

        public ApiHost(Type dcnApiType, bool fake, string dllPath, Log log)
        {
            this.log = log;
            Fake = fake;
            DllPath = dllPath;
            ApiVersion = dcnApiType.Assembly.GetName().Version?.ToString() ?? "";
            foreach (var p in dcnApiType.GetProperties(BindingFlags.Public | BindingFlags.Static))
            {
                if (!p.PropertyType.IsInterface) continue;
                var group = p.Name.EndsWith("Api", StringComparison.Ordinal) ? p.Name.Substring(0, p.Name.Length - 3).ToLowerInvariant() : p.Name.ToLowerInvariant();
                var root = new ApiRoot { Group = group, Interface = p.PropertyType, Instance = p.GetValue(null, null) };
                var all = AllInterfaces(root.Interface);
                root.Initialize = FindMethod(all, "Initialize");
                root.Terminate = FindMethod(all, "Terminate");
                root.IsAvailable = all.Select(i => i.GetProperty("IsAvailable")).FirstOrDefault(x => x != null);
                foreach (var prop in all.SelectMany(i => i.GetProperties()))
                {
                    if (prop.PropertyType.IsInterface)
                    {
                        var sub = Describe(group + "." + prop.Name, prop);
                        root.Subs[sub.Key] = sub;
                        Interfaces[sub.Key] = sub;
                    }
                    else if (IsFlag(prop)) root.Flags.Add(prop);
                }
                if (root.Initialize == null || root.IsAvailable == null) { log.Warn($"{p.Name}: not an IApi root (no Initialize/IsAvailable), skipped"); continue; }
                Roots[group] = root;
                // As in the vendor example: availability/authorization handlers are attached before Initialize.
                foreach (var ev in all.SelectMany(i => i.GetEvents()))
                {
                    if (ev.Name == "AvailabilityChange" || ev.Name == "AuthorizationChange")
                        ev.AddEventHandler(root.Instance, BuildHandler(ev.EventHandlerType, root.Group, ev.Name, true));
                }
            }
            if (Roots.Count == 0) throw new InvalidOperationException(dcnApiType.FullName + " exposes no IApi roots");
        }

        /// <summary>Standard DCN-SW installation folder below Program Files (DCN-SW 4.x installer, WO-069).</summary>
        public const string StandardInstallDir = @"Bosch\Digital Congress Network\DCN-SW";

        /// <summary>The folder with the DCN-SW API when no --dll-dir is given: next to the exe, the standard installation
        /// folder, or (other DCN-SW versions) the first folder below Program Files\Bosch that contains the API DLL.</summary>
        public static string FindDllDir(Log log)
        {
            var programFiles = new[] { Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.ProgramFiles }
                .Select(Environment.GetFolderPath).Where(p => p.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var candidates = new[] { AppDomain.CurrentDomain.BaseDirectory }
                .Concat(programFiles.Select(p => Path.Combine(p, StandardInstallDir))).ToArray();
            var found = candidates.FirstOrDefault(d => File.Exists(Path.Combine(d, LogicDll)))
                ?? programFiles.Select(p => Search(Path.Combine(p, "Bosch"), 4)).FirstOrDefault(d => d != null);
            if (found == null)
                throw new FileNotFoundException("DCN-SW API (" + LogicDll + ") not found next to dcn-bridge.exe, in "
                    + string.Join(" or ", programFiles.Select(p => Path.Combine(p, StandardInstallDir)))
                    + " or below Program Files\\Bosch. Pass the DCN-SW installation folder with --dll-dir \"<folder>\" (in quotes if it contains spaces).");
            log.Info("DCN-SW API found in " + found);
            return found;
        }

        static string Search(string dir, int depth)
        {
            if (!Directory.Exists(dir)) return null;
            if (File.Exists(Path.Combine(dir, LogicDll))) return dir;
            if (depth == 0) return null;
            try { return Directory.GetDirectories(dir).Select(d => Search(d, depth - 1)).FirstOrDefault(d => d != null); }
            catch (Exception e) when (e is UnauthorizedAccessException || e is IOException) { return null; }
        }

        /// <summary>Load the real DCN-SW API from the DLL folder.</summary>
        public static ApiHost LoadReal(string dllDir, Log log)
        {
            var dir = Path.GetFullPath(dllDir);
            var logic = Path.Combine(dir, LogicDll);
            if (!File.Exists(logic)) throw new FileNotFoundException("DCN-SW API not found: " + logic + " (--dll-dir must be the DCN-SW installation folder, e.g. \"C:\\Program Files (x86)\\" + StandardInstallDir + "\")");
            // The DCN-SW API assemblies are x86-only (32BITREQUIRED, WO-068): a 64-bit process cannot load them.
            if (Environment.Is64BitProcess)
                throw new InvalidOperationException("dcn-bridge runs as a 64-bit process, but the DCN-SW API DLLs are 32-bit only. Use the x86 build (default) or start it with the 32-bit runtime.");
            // Bosch.Dcn.Ecpc.Client.Logic calls RemotingConfiguration.Configure("Bosch.Dcn.Ecpc.Client.Logic.dll.config"), a
            // relative path: the working directory must be the DCN-SW folder, as for Bosch's own clients.
            Environment.CurrentDirectory = dir;
            var warnings = new List<string>();
            if (!File.Exists(Path.Combine(dir, RemotingConfig)))
                warnings.Add(RemotingConfig + " is missing in " + dir + ": the DCN-SW server cannot call back, so no events (mic on/off, lists, voting) will arrive.");
            AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
            {
                var file = Path.Combine(dir, new AssemblyName(e.Name).Name + ".dll");
                return File.Exists(file) ? Assembly.LoadFrom(file) : null;
            };
            var asm = Assembly.LoadFrom(logic);
            warnings.AddRange(MissingReferences(asm, dir));
            var type = asm.GetType(EntryType, true);
            var host = new ApiHost(type, false, logic, log);
            host.Warnings.AddRange(warnings);
            foreach (var w in warnings) log.Warn(w);
            return host;
        }

        /// <summary>Bosch/third-party assemblies the API needs (transitively) that are not in the DLL folder.</summary>
        static IEnumerable<string> MissingReferences(Assembly root, string dir)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var missing = new List<string>();
            var todo = new Stack<Assembly>(new[] { root });
            while (todo.Count > 0)
            {
                foreach (var r in todo.Pop().GetReferencedAssemblies())
                {
                    if (!seen.Add(r.Name) || r.Name.StartsWith("System", StringComparison.Ordinal) || r.Name == "mscorlib" || r.Name.StartsWith("Microsoft", StringComparison.Ordinal)) continue;
                    var file = new[] { ".dll", ".DLL" }.Select(ext => Path.Combine(dir, r.Name + ext)).FirstOrDefault(File.Exists);
                    if (file == null) { if (r.Name != "nunit.framework") missing.Add("referenced assembly not found in the DLL folder: " + r.FullName); continue; }
                    try { todo.Push(Assembly.LoadFrom(file)); } catch (Exception ex) { missing.Add("cannot load " + file + ": " + ex.Message); }
                }
            }
            return missing;
        }

        public static ApiHost LoadFake(Log log) => new ApiHost(typeof(Fake.FakeDcnApi), true, null, log);

        /// <summary>The interface and everything it inherits, collected recursively (IControlApi → IApi → IApiEvents),
        /// without relying on the runtime flattening GetInterfaces().</summary>
        static Type[] AllInterfaces(Type t)
        {
            var seen = new List<Type>();
            void Walk(Type x) { if (seen.Contains(x)) return; seen.Add(x); foreach (var i in x.GetInterfaces()) Walk(i); }
            Walk(t);
            return seen.ToArray();
        }

        static MethodInfo FindMethod(IEnumerable<Type> types, string name) =>
            types.Select(i => i.GetMethods().FirstOrDefault(m => m.Name == name)).FirstOrDefault(x => x != null);

        static bool IsFlag(PropertyInfo p) =>
            p.PropertyType == typeof(bool) && p.Name.StartsWith("Is", StringComparison.Ordinal) && p.Name != "IsAvailable" && p.GetIndexParameters().Length == 0;

        ApiInterface Describe(string key, PropertyInfo prop)
        {
            var sub = new ApiInterface { Key = key, Property = prop, Interface = prop.PropertyType };
            foreach (var i in AllInterfaces(sub.Interface))
            {
                if (i == typeof(IDisposable)) continue;
                foreach (var m in i.GetMethods())
                {
                    if (m.IsSpecialName) continue; // property/event accessors
                    if (sub.Methods.ContainsKey(m.Name)) { log.Warn($"{key}.{m.Name}: overloaded, only the first overload is reachable"); continue; }
                    sub.Methods[m.Name] = m;
                }
                sub.Events.AddRange(i.GetEvents());
                sub.Flags.AddRange(i.GetProperties().Where(IsFlag));
            }
            return sub;
        }

        // ------------------------------------------------------------------ connect / terminate

        /// <summary>Initialize the requested roots. Returns the API_ERROR name per root.</summary>
        public Dictionary<string, object> Connect(string server, string user, string password, IEnumerable<string> roots)
        {
            var result = new Dictionary<string, object>();
            var key = server + "\n" + user + "\n" + password;
            foreach (var group in roots)
            {
                if (!Roots.TryGetValue(group, out var root)) { result[group] = "UNKNOWN_ROOT"; continue; }
                if (root.Initialized && root.InitKey == key) { result[group] = "NONE"; continue; }
                if (root.Initialized) TerminateRoot(root);
                var code = InitializeWatched(root, server, user, password);
                if (code == "NONE" || code == "ALREADY_INITIALIZED")
                {
                    root.Initialized = true;
                    root.InitKey = key;
                    Subscribe(root);
                }
                result[group] = code;
            }
            StatusChanged?.Invoke();
            return result;
        }

        /// <summary>
        /// IApi.Initialize "blocks until the connection has been set up and the user authenticated"; one remark also says it
        /// blocks until Terminate(). Handle both: return when it returns, or when IsAvailable turns true while it still runs.
        /// </summary>
        string InitializeWatched(ApiRoot root, string server, string user, string password)
        {
            string code = null;
            Exception error = null;
            var thread = new Thread(() =>
            {
                try { code = Name(root.Initialize.Invoke(root.Instance, new object[] { server, user, password })); }
                catch (TargetInvocationException ex) { error = ex.InnerException ?? ex; }
                catch (Exception ex) { error = ex; }
            }) { IsBackground = true, Name = "Initialize " + root.Group };
            log.Info($"{root.Group}: Initialize({server}, {user})");
            thread.Start();
            var started = DateTime.UtcNow;
            while (!thread.Join(200))
            {
                if (DateTime.UtcNow - started > TimeSpan.FromSeconds(1) && Available(root))
                {
                    log.Warn($"{root.Group}: Initialize still blocking, but IsAvailable is true; continuing");
                    return "NONE";
                }
                if (DateTime.UtcNow - started > InitTimeout)
                {
                    log.Warn($"{root.Group}: Initialize did not return within {InitTimeout.TotalSeconds:0} s");
                    return "SETUP_LINK_FAILED";
                }
            }
            if (error != null) { log.Error($"{root.Group}: Initialize threw {error.GetType().Name}: {error.Message}"); return "ERROR"; }
            log.Info($"{root.Group}: Initialize → {code}");
            return code ?? "NONE";
        }

        void TerminateRoot(ApiRoot root)
        {
            try { log.Info($"{root.Group}: Terminate → {Name(root.Terminate?.Invoke(root.Instance, null))}"); }
            catch (Exception ex) { log.Warn($"{root.Group}: Terminate threw {(ex.InnerException ?? ex).Message}"); }
            root.Initialized = false;
            root.InitKey = null;
        }

        public void TerminateAll()
        {
            foreach (var r in Roots.Values) if (r.Initialized) TerminateRoot(r);
            StatusChanged?.Invoke();
        }

        /// <summary>Subscribe every event of every sub-interface once per process (they survive client reconnects).</summary>
        void Subscribe(ApiRoot root)
        {
            foreach (var sub in root.Subs.Values)
            {
                if (sub.Subscribed) continue;
                try
                {
                    sub.Instance = sub.Property.GetValue(root.Instance, null);
                    if (sub.Instance == null) { log.Warn($"{sub.Key}: property returned null"); continue; }
                    foreach (var ev in sub.Events) ev.AddEventHandler(sub.Instance, BuildHandler(ev.EventHandlerType, sub.Key, ev.Name, false));
                    sub.Subscribed = true;
                    log.Debug($"{sub.Key}: subscribed {sub.Events.Count} events");
                }
                catch (Exception ex)
                {
                    log.Error($"{sub.Key}: cannot subscribe events: {(ex.InnerException ?? ex).Message}");
                }
            }
        }

        /// <summary>A delegate of the event's handler type that forwards (sender, args) to <see cref="Sink"/>.</summary>
        Delegate BuildHandler(Type handlerType, string key, string name, bool status)
        {
            var invoke = handlerType.GetMethod("Invoke");
            var ps = invoke.GetParameters().Select(p => Expression.Parameter(p.ParameterType, p.Name)).ToArray();
            Expression args = ps.Length > 1 ? (Expression)Expression.Convert(ps[1], typeof(object)) : Expression.Constant(null, typeof(object));
            var sink = typeof(ApiHost).GetMethod(nameof(Sink), BindingFlags.NonPublic | BindingFlags.Instance);
            var body = Expression.Call(Expression.Constant(this), sink, Expression.Constant(key), Expression.Constant(name), Expression.Constant(status), args);
            return Expression.Lambda(handlerType, body, ps).Compile();
        }

        void Sink(string key, string name, bool status, object args)
        {
            try
            {
                if (status) { log.Info($"{key}: {name}"); StatusChanged?.Invoke(); return; }
                ApiEvent?.Invoke(key, name, ClrConvert.FromClr(args));
            }
            catch (Exception ex) { log.Error($"event {key}.{name}: {ex.Message}"); } // never throw into the API's thread
        }

        // ------------------------------------------------------------------ calls

        /// <summary>Invoke a method by name with arguments by parameter name. Returns { returns, out }.</summary>
        public Dictionary<string, object> Call(string apiKey, string method, Dictionary<string, object> args)
        {
            if (!Interfaces.TryGetValue(apiKey, out var sub)) throw new BridgeError("UNKNOWN_API", "no interface " + apiKey);
            if (!sub.Methods.TryGetValue(method, out var m)) throw new BridgeError("UNKNOWN_METHOD", "no method " + apiKey + "." + method);
            var root = Roots[apiKey.Substring(0, apiKey.IndexOf('.'))];
            if (!root.Initialized || sub.Instance == null) throw new BridgeError("NOT_INITIALIZED", root.Group + " API not initialized");

            var ps = m.GetParameters();
            foreach (var name in args.Keys)
            {
                var p = ps.FirstOrDefault(x => x.Name == name);
                if (p == null || p.IsOut) throw new BadArgsException(name + ": unknown parameter");
            }
            var values = new object[ps.Length];
            for (var i = 0; i < ps.Length; i++)
            {
                var p = ps[i];
                if (p.IsOut) continue;
                if (!args.TryGetValue(p.Name, out var json)) throw new BadArgsException(p.Name + ": missing (" + p.ParameterType.Name.TrimEnd('&') + ")");
                values[i] = ClrConvert.ToClr(json, p.ParameterType, p.Name);
            }
            object ret;
            try { ret = m.Invoke(sub.Instance, values); }
            catch (TargetInvocationException ex) { throw new ApiCallException(ex.InnerException ?? ex); }
            var outs = new Dictionary<string, object>();
            for (var i = 0; i < ps.Length; i++)
                if (ps[i].ParameterType.IsByRef) outs[ps[i].Name] = ClrConvert.FromClr(values[i]);
            return new Dictionary<string, object> { ["returns"] = m.ReturnType == typeof(void) ? "NONE" : ClrConvert.FromClr(ret), ["out"] = outs };
        }

        // ------------------------------------------------------------------ status, constants

        static bool Available(ApiRoot root)
        {
            try { return (bool)root.IsAvailable.GetValue(root.Instance, null); }
            catch { return false; }
        }

        public Dictionary<string, object> Status()
        {
            var status = new Dictionary<string, object>();
            foreach (var root in Roots.Values)
            {
                var allowed = new Dictionary<string, object>();
                if (root.Initialized)
                {
                    foreach (var f in root.Flags) allowed[f.Name] = ReadFlag(f, root.Instance);
                    foreach (var sub in root.Subs.Values)
                        if (sub.Instance != null)
                            foreach (var f in sub.Flags) allowed[sub.Property.Name + "." + f.Name] = ReadFlag(f, sub.Instance);
                }
                status[root.Group] = new Dictionary<string, object>
                {
                    ["initialized"] = root.Initialized,
                    ["available"] = root.Initialized && Available(root),
                    ["allowed"] = allowed,
                };
            }
            return status;
        }

        static bool ReadFlag(PropertyInfo f, object target)
        {
            try { return (bool)f.GetValue(target, null); }
            catch { return false; }
        }

        /// <summary>const / static readonly fields of the API's structs, e.g. "SEAT_ASSIGNMENT.DEFAULT_AREA": 0.</summary>
        public Dictionary<string, object> Constants()
        {
            var result = new Dictionary<string, object>();
            var ns = Roots.Values.First().Interface.Namespace;
            Type[] types;
            try { types = Roots.Values.First().Interface.Assembly.GetTypes(); }
            catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray(); }
            foreach (var t in types.Where(t => t.IsPublic && t.Namespace == ns && !t.IsEnum && !t.IsInterface))
            {
                foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.Static))
                {
                    if (!(f.IsLiteral || f.IsInitOnly)) continue;
                    var v = f.IsLiteral ? f.GetRawConstantValue() : f.GetValue(null);
                    if (v == null || v is string || v.GetType().IsPrimitive || v.GetType().IsEnum) result[t.Name + "." + f.Name] = ClrConvert.FromClr(v);
                }
            }
            return result;
        }

        static string Name(object apiError) => apiError == null ? null : Convert.ToString(ClrConvert.FromClr(apiError));
    }
}
