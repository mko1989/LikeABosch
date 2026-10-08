// Command line + config file options shared by the LikeABosch bridges: --key value / --flag pairs (camelCase keys,
// --dll-dir → dllDir), merged over a JSON config file next to the exe; environment variables as fallback.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BridgeCore
{
    public static class Options
    {
        /// <summary>
        /// Parse argv over the config file (<paramref name="configFile"/> next to the exe, or --config). A path given without
        /// quotes is split by cmd at its spaces (C:\Program Files\…): for <paramref name="pathKeys"/> the words up to the
        /// next --option are joined back together.
        /// </summary>
        public static Dictionary<string, string> Parse(string[] argv, string configFile, ISet<string> flags, ISet<string> pathKeys)
        {
            var cli = new Dictionary<string, string>(StringComparer.Ordinal);
            for (var i = 0; i < argv.Length; i++)
            {
                if (!argv[i].StartsWith("--", StringComparison.Ordinal)) throw new ArgumentException("unexpected argument " + argv[i] + " (values with spaces need quotes; see --help)");
                var key = Camel(argv[i].Substring(2));
                cli[key] = flags.Contains(key) ? "true" : (i + 1 < argv.Length ? argv[++i] : throw new ArgumentException(argv[i] + " needs a value"));
                if (pathKeys.Contains(key))
                    while (i + 1 < argv.Length && !argv[i + 1].StartsWith("--", StringComparison.Ordinal)) cli[key] += " " + argv[++i];
            }
            var file = cli.TryGetValue("config", out var c) ? c : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, configFile);
            var merged = new Dictionary<string, string>(StringComparer.Ordinal);
            if (File.Exists(file))
            {
                if (Json.Parse(File.ReadAllText(file)) is Dictionary<string, object> cfg)
                    foreach (var kv in cfg)
                    {
                        if (kv.Value is bool b) { if (b) merged[kv.Key] = "true"; }
                        else if (kv.Value != null) merged[kv.Key] = Convert.ToString(kv.Value, System.Globalization.CultureInfo.InvariantCulture);
                    }
            }
            else if (cli.ContainsKey("config")) throw new FileNotFoundException("config file not found: " + file);
            foreach (var kv in cli) merged[kv.Key] = kv.Value;
            return merged;
        }

        public static string Camel(string flag)
        {
            var parts = flag.Split('-');
            return parts[0] + string.Concat(parts.Skip(1).Select(p => p.Length == 0 ? "" : char.ToUpperInvariant(p[0]) + p.Substring(1)));
        }

        /// <summary>Option, else environment variable, else fallback.</summary>
        public static string Get(Dictionary<string, string> opt, string key, string env, string fallback)
        {
            if (opt.TryGetValue(key, out var v)) return v;
            var e = Environment.GetEnvironmentVariable(env);
            return string.IsNullOrEmpty(e) ? fallback : e;
        }
    }
}
