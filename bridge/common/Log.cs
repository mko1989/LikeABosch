// Console logger shared by the LikeABosch bridges.
using System;

namespace BridgeCore
{
    public sealed class Log
    {
        public bool Verbose;
        readonly object gate = new object();
        void Write(string level, string message)
        {
            lock (gate) Console.WriteLine($"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {level} {message}");
        }
        public void Debug(string m) { if (Verbose) Write("DEBUG", m); }
        public void Info(string m) => Write("INFO ", m);
        public void Warn(string m) => Write("WARN ", m);
        public void Error(string m) => Write("ERROR", m);
    }
}
