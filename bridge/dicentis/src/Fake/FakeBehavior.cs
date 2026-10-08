// Behaviour of the generated DCNM API fake (Fake.generated.cs, WO-078): just enough DICENTIS to test the bridge
// generically: the connect sequence (open → authenticate admin/admin → connect as device), capabilities, events raised
// on thread-pool threads after a request (like the real API), a speakers list, participant registration with data
// classes, plugin handles and callbacks. Test knobs: ControlSpeaker.SetSpeechTimeAsync with speechDuration -1 never
// completes (TIMEOUT), -2 fails (EXCEPTION).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using BridgeCore;

namespace DicentisBridge.Fake
{
    /// <summary>Base of every generated fake: properties by name, event handlers, method dispatch to FakeBehavior.</summary>
    public abstract class FakeObject
    {
        public readonly string InterfaceName;
        readonly Dictionary<string, object> props = new Dictionary<string, object>(StringComparer.Ordinal);
        readonly Dictionary<string, Delegate> handlers = new Dictionary<string, Delegate>(StringComparer.Ordinal);

        protected FakeObject(string interfaceName) { InterfaceName = interfaceName; }

        /// <summary>Members declared by IApi on another object (IDeviceApi : IApi) go to the Base fake.</summary>
        FakeObject Owner(string iface) => iface == "IApi" && InterfaceName != "IApi" && FakeBehavior.Base != null ? FakeBehavior.Base : this;

        protected void On(string iface, string ev, Delegate d) { var o = Owner(iface); lock (o.handlers) o.handlers[iface + "." + ev] = Delegate.Combine(o.handlers.TryGetValue(iface + "." + ev, out var x) ? x : null, d); }
        protected void Off(string iface, string ev, Delegate d) { var o = Owner(iface); lock (o.handlers) if (o.handlers.TryGetValue(iface + "." + ev, out var x)) o.handlers[iface + "." + ev] = Delegate.Remove(x, d); }

        protected T Get<T>(string iface, string name)
        {
            var o = Owner(iface);
            lock (o.props) if (o.props.TryGetValue(name, out var v)) return (T)v;
            return FakeBehavior.Default<T>(name);
        }

        protected void Set(string iface, string name, object value) { var o = Owner(iface); lock (o.props) o.props[name] = value; }

        public object this[string name]
        {
            get { lock (props) return props.TryGetValue(name, out var v) ? v : null; }
            set { lock (props) props[name] = value; }
        }

        /// <summary>Raise an event of this object's interface now (args: the EventArgs object).</summary>
        public void Raise(string iface, string ev, object args)
        {
            Delegate d;
            lock (handlers) handlers.TryGetValue(iface + "." + ev, out d);
            d?.DynamicInvoke(this, args ?? EventArgs.Empty);
        }

        /// <summary>The EventArgs type of an event of one of this object's interfaces.</summary>
        public Type ArgsType(string iface, string ev)
        {
            var e = GetType().GetInterfaces().Where(i => i.Name == iface).Select(i => i.GetEvent(ev)).FirstOrDefault(x => x != null);
            if (e == null) return null;
            var p = e.EventHandlerType.GetMethod("Invoke").GetParameters();
            return p.Length > 1 ? p[1].ParameterType : typeof(EventArgs);
        }

        protected Task<T> Done<T>(string iface, string method, Delegate onFinish, params object[] args)
        {
            var o = Owner(iface);
            var task = FakeBehavior.Invoke<T>(o, iface, method, args);
            if (onFinish != null) task.ContinueWith(t => onFinish.DynamicInvoke(t));
            return task;
        }

        protected Task Done0(string iface, string method, Delegate onFinish, params object[] args)
        {
            Task task = Done<object>(iface, method, null, args);
            if (onFinish != null) task.ContinueWith(t => onFinish.DynamicInvoke(t));
            return task;
        }

        protected T Sync<T>(string iface, string method, params object[] args) => Done<T>(iface, method, null, args).GetAwaiter().GetResult();
    }

    public static class FakeBehavior
    {
        static readonly List<FakeObject> all = new List<FakeObject>();
        public static FakeObject Base, Device, Speaker, Participants;

        public static T Register<T>(T fake) where T : FakeObject
        {
            lock (all) all.Add(fake);
            switch (fake.InterfaceName)
            {
                case "IApi": Base = fake; break;
                case "IDeviceApi": Device = fake; break;
                case "IControlSpeaker": Speaker = fake; break;
                case "IPrepareParticipant2": Participants = fake; break;
            }
            return fake;
        }

        /// <summary>Initial state once every fake exists.</summary>
        public static void Wire()
        {
            Base["IsOpen"] = false;
            Base["CanAuthenticate"] = false;
            Base["IsUserLoggedOn"] = false;
            Base["CurrentApiState"] = DcnmApiState.Offline;
            Base["DicentisVersion"] = new Version(7, 0, 43431, 0);
            Device["CurrentDeviceConnectionState"] = DcnmDeviceConnectionState.Disconnected;
            Device["CanConnectAsDevice"] = false;
            Device["IsEnabledAsDevice"] = false;
            Speaker["SpeakersListChanged"] = new List<DcnmSpeakerInfo>();
        }

        public static void Shutdown() { }

        /// <summary>Property default: Can… false until a user logged on, everything else the type's default.</summary>
        public static T Default<T>(string name)
        {
            if (typeof(T) == typeof(bool) && name.StartsWith("Can", StringComparison.Ordinal)) return (T)(object)(Base != null && (bool)(Base["IsUserLoggedOn"] ?? false));
            return (T)DefaultValue(typeof(T));
        }

        static object DefaultValue(Type t)
        {
            if (t == typeof(bool)) return true; // Request…Async: "delivered"
            if (t == typeof(string)) return "";
            if (t.IsValueType) return Activator.CreateInstance(t);
            if (t.IsArray) return Array.CreateInstance(t.GetElementType(), 0);
            if (t.IsGenericType && typeof(IEnumerable).IsAssignableFrom(t))
            {
                var list = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(t.GetGenericArguments()[0]));
                if (t.IsAssignableFrom(list.GetType())) return list;
                var ctor = t.GetConstructors().FirstOrDefault(c => c.GetParameters().Length == 1 && c.GetParameters()[0].ParameterType.IsAssignableFrom(list.GetType()));
                return ctor?.Invoke(new object[] { list });
            }
            return null;
        }

        /// <summary>Raise an event on a pool thread shortly after the call, as the real API does.</summary>
        static void Later(FakeObject o, string iface, string ev, object parameter, int delayMs = 20) =>
            Task.Delay(delayMs).ContinueWith(_ =>
            {
                var argsType = o.ArgsType(iface, ev);
                if (argsType == null) return;
                var args = argsType == typeof(EventArgs) ? EventArgs.Empty : Activator.CreateInstance(argsType, parameter);
                o.Raise(iface, ev, args);
            });

        static void CapabilitiesChanged()
        {
            List<FakeObject> list;
            lock (all) list = all.ToList();
            foreach (var o in list)
                foreach (var i in o.GetType().GetInterfaces().Where(i => i.GetEvent("CapabilitiesChanged") != null))
                    Later(o, i.Name, "CapabilitiesChanged", null, 30);
        }

        static Task<T> Result<T>(object value) => Task.FromResult(value == null ? (T)DefaultValue(typeof(T)) : (T)value);

        public static Task<T> Invoke<T>(FakeObject o, string iface, string method, object[] a)
        {
            switch (iface + "." + method)
            {
                case "IApi.OpenAsync":
                    Task.Delay(30).ContinueWith(_ =>
                    {
                        Base["IsOpen"] = true;
                        Base["CurrentApiState"] = DcnmApiState.Online;
                        Base["CanAuthenticate"] = true;
                        Base["OpenedHost"] = a.Length > 0 ? a[0] : null;
                        Later(Base, "IApi", "OpenStateChanged", true, 0);
                        Later(Base, "IApi", "ApiStateChanged", DcnmApiState.Online, 0);
                    });
                    return Result<T>(true);
                case "IApi.AuthenticateUserAsync":
                {
                    var ok = (string)a[0] == "admin" && (string)a[1] == "admin";
                    if (ok)
                    {
                        Base["IsUserLoggedOn"] = true;
                        Base["LoggedOnUserId"] = Guid.Parse("00000000-0000-0000-0000-00000000ad31");
                        Device["CanConnectAsDevice"] = true;
                        CapabilitiesChanged();
                    }
                    return Result<T>(ok);
                }
                case "IApi.RevokeUserAsync":
                    Base["IsUserLoggedOn"] = false;
                    Device["CanConnectAsDevice"] = false;
                    CapabilitiesChanged();
                    return Result<T>(null);
                case "IApi.CloseAsync":
                    Base["IsOpen"] = false;
                    Base["CanAuthenticate"] = false;
                    Base["CurrentApiState"] = DcnmApiState.Offline;
                    Later(Base, "IApi", "OpenStateChanged", false, 0);
                    return Result<T>(null);
                case "IDeviceApi.ConnectAsDeviceAsync":
                    Device["CurrentDeviceConnectionState"] = DcnmDeviceConnectionState.Connecting;
                    Device["DeviceName"] = a[0];
                    Task.Delay(30).ContinueWith(_ =>
                    {
                        Device["CurrentDeviceConnectionState"] = DcnmDeviceConnectionState.Connected;
                        Device["IsEnabledAsDevice"] = true;
                        Later(Device, "IDeviceApi", "DeviceApiConnectionStateChanged", DcnmDeviceConnectionState.Connected, 0);
                        Later(Device, "IDeviceApi", "ConnectionStateChanged", true, 0);
                        Later(Device, "IDeviceApi", "EnabledStateChanged", true, 0);
                    });
                    return Result<T>(true);
                case "IDeviceApi.DisconnectAsDeviceAsync":
                    Device["CurrentDeviceConnectionState"] = DcnmDeviceConnectionState.Disconnected;
                    Device["IsEnabledAsDevice"] = false;
                    Later(Device, "IDeviceApi", "DeviceApiConnectionStateChanged", DcnmDeviceConnectionState.Disconnected, 0);
                    return Result<T>(true);
                case "IControlSpeaker.GrantSpeechAsync":
                {
                    var list = Speakers();
                    lock (list) list.Add(new DcnmSpeakerInfo((Guid)a[0], DcnmMicrophoneState.On, null, null));
                    Later(Speaker, "IControlSpeaker", "SpeakersListChanged", Snapshot(list));
                    return Result<T>(true);
                }
                case "IControlSpeaker.CancelSpeakersAsync":
                {
                    var ids = ((IEnumerable<Guid>)a[0]).ToList();
                    var list = Speakers();
                    lock (list) list.RemoveAll(s => ids.Contains(s.SpeakerId));
                    Later(Speaker, "IControlSpeaker", "SpeakersListChanged", Snapshot(list));
                    return Result<T>(true);
                }
                case "IControlSpeaker.SetSpeechTimeAsync":
                    if ((int)a[1] == -1) return new TaskCompletionSource<T>().Task; // never completes
                    if ((int)a[1] == -2) return Task.FromException<T>(new InvalidOperationException("fake failure"));
                    return Result<T>(true);
                case "IPrepareParticipant2.RegisterParticipantsAsync":
                {
                    var registered = ((IEnumerable<DcnmParticipantPreparationInfo2>)a[0]).ToList();
                    Participants["Registered"] = registered;
                    var result = new List<DcnmParticipantAndUserInfo>();
                    Later(Participants, "IPrepareParticipant2", "ParticipantsRegistered", result);
                    return Result<T>(result);
                }
                case "IPlugin.RegisterPluginAsync":
                {
                    var instance = Register(new FakeIPluginInstance());
                    instance["Description"] = a[0];
                    // A plugin client calls the registered command handler: the bridge turns it into a callback.
                    var handler = (PluginCommandDelegate)a[1];
                    if (handler != null)
                        // Awaited, not blocked on: a blocked pool thread (up to the callback timeout) would delay every other event.
                        Task.Delay(50).ContinueWith(_ => handler(new DcnmPluginCommand { PluginName = "fake", Command = "PING", Parameters = "{}" }, CancellationToken.None))
                            .Unwrap().ContinueWith(t => instance["CommandResult"] = t.Status == TaskStatus.RanToCompletion ? t.Result : null);
                    return Result<T>(instance);
                }
                case "IPlugin.SubscribePluginEventAsync":
                {
                    var handler = (PluginEventDelegate)a[2];
                    Task.Delay(50).ContinueWith(_ => handler?.Invoke(new DcnmPluginEvent { PluginName = (string)a[0], Event = (string)a[1], Parameters = "{\"fake\":true}" }));
                    return Result<T>(true);
                }
            }
            // Generic: Request<X>Async makes <X>Changed fire with the stored state (or an empty value).
            if (method.StartsWith("Request", StringComparison.Ordinal) && method.EndsWith("Async", StringComparison.Ordinal))
            {
                var ev = method.Substring(7, method.Length - 12) + "Changed";
                var argsType = o.ArgsType(iface, ev);
                if (argsType != null && argsType != typeof(EventArgs))
                {
                    var payloadType = argsType.GetProperty("Parameter")?.PropertyType;
                    var state = o[ev];
                    var payload = state is IList l ? SnapshotOf(l, payloadType) : state ?? (payloadType == null ? null : DefaultValue(payloadType));
                    Later(o, iface, ev, payload);
                }
                else if (argsType == typeof(EventArgs)) Later(o, iface, ev, null);
            }
            return Result<T>(null);
        }

        static List<DcnmSpeakerInfo> Speakers() => (List<DcnmSpeakerInfo>)Speaker["SpeakersListChanged"];
        static IList<DcnmSpeakerInfo> Snapshot(List<DcnmSpeakerInfo> list) { lock (list) return list.ToList(); }

        static object SnapshotOf(IList list, Type target)
        {
            if (target == null) return list;
            var copy = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(target.IsGenericType ? target.GetGenericArguments()[0] : typeof(object)));
            lock (list) foreach (var x in list) copy.Add(x);
            return copy;
        }
    }
}
