// Bridge protocol server shared by dcn-bridge and dicentis-bridge (DEC-017, DEC-021): TCP, newline-delimited JSON,
// one client at a time, hello (+ optional token, DEC-019), id-matched responses, pushed messages.
// What a request does is up to the IBridgeHost; this class only does transport and the envelope.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace BridgeCore
{
    /// <summary>The API side of a bridge.</summary>
    public interface IBridgeHost
    {
        /// <summary>"dcn-bridge" / "dicentis-bridge".</summary>
        string Name { get; }
        /// <summary>Fields of hello.bridge besides name, version and runtime (apiVersion, fake, dllPath, …).</summary>
        Dictionary<string, object> BridgeInfo();
        /// <summary>The hello answer's fields besides type/ok/protocol/bridge (status, constants, interfaces, …).</summary>
        Task<Dictionary<string, object>> HelloExtras();
        /// <summary>Run one request (`type` is not hello/ping). Throws BridgeError, BadArgsException or ApiCallException.</summary>
        Task<object> Handle(string type, Dictionary<string, object> message);
        /// <summary>Messages for the current client (event, status).</summary>
        event Action<Dictionary<string, object>> Push;
    }

    public sealed class BridgeServer
    {
        public const int Protocol = 1;
        const int MaxLine = 16 * 1024 * 1024;

        readonly IBridgeHost host;
        readonly string token;
        readonly Log log;
        readonly TcpListener listener;
        readonly object gate = new object();
        Connection current;

        public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;

        public BridgeServer(IBridgeHost host, IPAddress address, int port, string token, Log log)
        {
            this.host = host;
            this.token = token ?? "";
            this.log = log;
            listener = new TcpListener(address, port);
            host.Push += Push;
        }

        public void Start()
        {
            listener.Start();
            new Thread(AcceptLoop) { IsBackground = true, Name = "accept" }.Start();
            var fake = host.BridgeInfo().TryGetValue("fake", out var f) && f is bool b && b;
            log.Info($"listening on {listener.LocalEndpoint} (protocol {Protocol}{(fake ? ", FAKE API" : "")})");
        }

        public void Stop()
        {
            Push(new Dictionary<string, object> { ["type"] = "closed", ["reason"] = "shutdown" });
            listener.Stop();
        }

        void AcceptLoop()
        {
            while (true)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch (Exception) { return; } // stopped
                var conn = new Connection(client, log);
                new Thread(() => Serve(conn)) { IsBackground = true, Name = "client " + conn.Remote }.Start();
            }
        }

        void Push(Dictionary<string, object> message)
        {
            Connection c;
            lock (gate) c = current;
            c?.Send(message);
        }

        void Serve(Connection conn)
        {
            log.Info($"{conn.Remote}: connected");
            var authed = false;
            try
            {
                conn.Client.ReceiveTimeout = 5000; // hello within 5 s
                while (true)
                {
                    var line = conn.ReadLine();
                    if (line == null) break;
                    if (line.Trim().Length == 0) continue;
                    Dictionary<string, object> msg;
                    try { msg = Json.Parse(line) as Dictionary<string, object>; }
                    catch (Exception ex) { conn.Send(Error(null, "BAD_REQUEST", "not JSON: " + ex.Message)); continue; }
                    if (msg == null) { conn.Send(Error(null, "BAD_REQUEST", "expected a JSON object")); continue; }
                    var type = msg.TryGetValue("type", out var t) ? t as string : null;
                    msg.TryGetValue("id", out var id);

                    if (type == "hello")
                    {
                        var given = msg.TryGetValue("token", out var tk) ? tk as string : null;
                        if (token.Length > 0 && !FixedTimeEquals(given ?? "", token)) // no token configured: open (DEC-019)
                        {
                            log.Warn($"{conn.Remote}: wrong token");
                            conn.Send(new Dictionary<string, object> { ["type"] = "hello", ["ok"] = false, ["error"] = Err("BAD_TOKEN", "wrong token") });
                            break;
                        }
                        authed = true;
                        conn.Client.ReceiveTimeout = 0;
                        Connection old;
                        lock (gate) { old = current; current = conn; }
                        if (old != null && old != conn)
                        {
                            log.Info($"{old.Remote}: replaced by {conn.Remote}");
                            old.Send(new Dictionary<string, object> { ["type"] = "closed", ["reason"] = "replaced" });
                            old.Close();
                        }
                        SendHello(conn);
                        continue;
                    }
                    if (!authed) { conn.Send(Error(id, "NOT_HELLO", "send hello first")); continue; }
                    if (type == "ping") { conn.Send(Ok(id, new Dictionary<string, object> { ["time"] = DateTime.UtcNow.ToString("o") })); continue; }
                    Dispatch(conn, type, id, msg);
                }
            }
            catch (IOException) { /* closed or hello timeout */ }
            catch (Exception ex) { log.Error($"{conn.Remote}: {ex.Message}"); }
            finally
            {
                lock (gate) if (current == conn) current = null;
                conn.Close();
                log.Info($"{conn.Remote}: disconnected");
            }
        }

        void SendHello(Connection conn)
        {
            host.HelloExtras().ContinueWith(task =>
            {
                if (task.IsFaulted) { log.Error("hello: " + Unwrap(task.Exception).Message); return; }
                var bridge = new Dictionary<string, object>
                {
                    ["name"] = host.Name,
                    ["version"] = (Assembly.GetEntryAssembly() ?? typeof(BridgeServer).Assembly).GetName().Version.ToString(3),
                };
                foreach (var kv in host.BridgeInfo()) bridge[kv.Key] = kv.Value;
                bridge["runtime"] = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription;
                var hello = new Dictionary<string, object> { ["type"] = "hello", ["ok"] = true, ["protocol"] = Protocol, ["bridge"] = bridge };
                foreach (var kv in task.Result) hello[kv.Key] = kv.Value;
                conn.Send(hello);
            });
        }

        /// <summary>Hand the request to the host; the response goes out when its task completes (hosts decide the order).</summary>
        void Dispatch(Connection conn, string type, object id, Dictionary<string, object> msg)
        {
            Task<object> task;
            try { task = host.Handle(type, msg); }
            catch (Exception ex) { conn.Send(ErrorFor(id, ex)); return; }
            task.ContinueWith(t => conn.Send(t.IsFaulted ? ErrorFor(id, Unwrap(t.Exception)) : t.IsCanceled ? Error(id, "TIMEOUT", "cancelled") : Ok(id, t.Result)));
        }

        Dictionary<string, object> ErrorFor(object id, Exception ex)
        {
            switch (ex)
            {
                case BridgeError be: return Error(id, be.Code, be.Message);
                case BadArgsException ba: return Error(id, "BAD_ARGS", ba.Message);
                case ApiCallException ae: log.Warn(ae.Message); return Error(id, "EXCEPTION", ae.Message);
                default: log.Error(ex.ToString()); return Error(id, "EXCEPTION", ex.GetType().Name + ": " + ex.Message);
            }
        }

        static Exception Unwrap(Exception ex)
        {
            while (ex is AggregateException ag && ag.InnerExceptions.Count == 1) ex = ag.InnerException;
            return ex;
        }

        public static string Str(Dictionary<string, object> msg, string key)
        {
            if (msg.TryGetValue(key, out var v) && v is string s) return s;
            throw new BridgeError("BAD_REQUEST", "missing string field '" + key + "'");
        }

        static Dictionary<string, object> Ok(object id, object result) =>
            new Dictionary<string, object> { ["type"] = "response", ["id"] = id, ["ok"] = true, ["result"] = result };

        static Dictionary<string, object> Error(object id, string code, string message) =>
            new Dictionary<string, object> { ["type"] = "response", ["id"] = id, ["ok"] = false, ["error"] = Err(code, message) };

        static Dictionary<string, object> Err(string code, string message) =>
            new Dictionary<string, object> { ["code"] = code, ["message"] = message };

        static bool FixedTimeEquals(string a, string b)
        {
            var x = Encoding.UTF8.GetBytes(a);
            var y = Encoding.UTF8.GetBytes(b);
            var diff = x.Length ^ y.Length;
            for (var i = 0; i < Math.Min(x.Length, y.Length); i++) diff |= x[i] ^ y[i];
            return diff == 0;
        }

        sealed class Connection
        {
            public readonly TcpClient Client;
            public readonly string Remote;
            readonly NetworkStream stream;
            readonly object writeLock = new object();
            readonly Log log;
            readonly byte[] buffer = new byte[64 * 1024];
            readonly MemoryStream pending = new MemoryStream();

            public Connection(TcpClient client, Log log)
            {
                Client = client;
                this.log = log;
                client.NoDelay = true;
                Remote = client.Client.RemoteEndPoint?.ToString() ?? "?";
                stream = client.GetStream();
            }

            /// <summary>Next line without the newline, or null when the peer closed.</summary>
            public string ReadLine()
            {
                while (true)
                {
                    var bytes = pending.GetBuffer();
                    for (var i = 0; i < pending.Length; i++)
                    {
                        if (bytes[i] != (byte)'\n') continue;
                        var line = Encoding.UTF8.GetString(bytes, 0, i);
                        var rest = (int)pending.Length - i - 1;
                        Buffer.BlockCopy(bytes, i + 1, bytes, 0, rest);
                        pending.SetLength(rest);
                        pending.Position = rest; // SetLength does not move the position; the next Write appends here
                        return line;
                    }
                    if (pending.Length > MaxLine) throw new IOException("message too long");
                    var n = stream.Read(buffer, 0, buffer.Length);
                    if (n <= 0) return null;
                    pending.Write(buffer, 0, n);
                }
            }

            public void Send(Dictionary<string, object> message)
            {
                var data = Encoding.UTF8.GetBytes(Json.Write(message) + "\n");
                lock (writeLock)
                {
                    try { stream.Write(data, 0, data.Length); }
                    catch (Exception ex) { log.Debug($"{Remote}: send failed: {ex.Message}"); }
                }
            }

            public void Close()
            {
                try { Client.Close(); } catch { /* already closed */ }
            }
        }
    }

    /// <summary>A single worker thread: jobs run one at a time in submission order (the dcn-bridge's request model).</summary>
    public sealed class SerialWorker
    {
        readonly System.Collections.Concurrent.BlockingCollection<Action> work = new System.Collections.Concurrent.BlockingCollection<Action>();
        readonly Log log;

        public SerialWorker(string name, Log log)
        {
            this.log = log;
            new Thread(() => { foreach (var job in work.GetConsumingEnumerable()) Run(job); }) { IsBackground = true, Name = name }.Start();
        }

        void Run(Action job)
        {
            try { job(); }
            catch (Exception ex) { log.Error("worker: " + ex); }
        }

        public void Post(Action job) { if (!work.IsAddingCompleted) work.Add(job); }

        /// <summary>Run <paramref name="fn"/> on the worker; the task completes with its result or exception.</summary>
        public Task<T> Run<T>(Func<T> fn)
        {
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            Post(() =>
            {
                try { tcs.SetResult(fn()); }
                catch (Exception ex) { tcs.SetException(ex); }
            });
            return tcs.Task;
        }

        public void Stop() => work.CompleteAdding();
    }
}
