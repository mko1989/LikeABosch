// JSON ↔ .NET value conversion for the bridge protocols (docs/protocol/dcn-swapi/BRIDGE.md and
// docs/protocol/dcnm-api/BRIDGE.md "Value encoding"). Shared by dcn-bridge and dicentis-bridge (DEC-021).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Reflection;

namespace BridgeCore
{
    /// <summary>A protocol error with a BRIDGE.md error code.</summary>
    public sealed class BridgeError : Exception
    {
        public readonly string Code;
        public BridgeError(string code, string message) : base(message) { Code = code; }
    }

    /// <summary>Thrown for arguments that do not fit the parameter type (→ BAD_ARGS).</summary>
    public sealed class BadArgsException : Exception
    {
        public BadArgsException(string message) : base(message) { }
    }

    /// <summary>The API threw (→ EXCEPTION).</summary>
    public sealed class ApiCallException : Exception
    {
        public ApiCallException(Exception inner) : base(inner.GetType().Name + ": " + inner.Message, inner) { }
    }

    public static class ClrConvert
    {
        const int MaxDepth = 10;

        /// <summary>Generic collection types an array converts to (IList&lt;T&gt;, Collection&lt;T&gt;, …).</summary>
        static readonly Type[] ListLike =
        {
            typeof(IList<>), typeof(List<>), typeof(ICollection<>), typeof(IEnumerable<>), typeof(IReadOnlyList<>),
            typeof(IReadOnlyCollection<>), typeof(Collection<>), typeof(ReadOnlyCollection<>), typeof(ObservableCollection<>),
        };

        /// <summary>JSON value (from <see cref="Json.Parse"/>) → instance of <paramref name="type"/>.</summary>
        public static object ToClr(object json, Type type, string path)
        {
            if (type.IsByRef) type = type.GetElementType();
            var nullable = Nullable.GetUnderlyingType(type);
            if (nullable != null) return json == null ? null : ToClr(json, nullable, path);

            if (json == null)
            {
                if (!type.IsValueType) return null;
                throw new BadArgsException(path + ": null is not a valid " + type.Name);
            }
            if (type == typeof(object)) return json;
            if (type == typeof(string))
            {
                if (json is string s) return s;
                throw new BadArgsException(path + ": expected a string");
            }
            if (type == typeof(bool))
            {
                if (json is bool b) return b;
                throw new BadArgsException(path + ": expected true or false");
            }
            if (type.IsEnum)
            {
                if (json is string name)
                {
                    foreach (var n in Enum.GetNames(type))
                        if (n == name) return Enum.Parse(type, n);
                    throw new BadArgsException(path + ": '" + name + "' is not a member of " + type.Name + " (" + string.Join(", ", Enum.GetNames(type)) + ")");
                }
                if (json is long num) return Enum.ToObject(type, num);
                throw new BadArgsException(path + ": expected a " + type.Name + " name or number");
            }
            if (IsNumber(type))
            {
                if (json is long || json is double)
                {
                    try
                    {
                        if (IsInteger(type) && json is double d && Math.Floor(d) != d) throw new OverflowException();
                        return Convert.ChangeType(json, type, CultureInfo.InvariantCulture);
                    }
                    catch (OverflowException) { throw new BadArgsException(path + ": " + json + " does not fit " + type.Name); }
                }
                throw new BadArgsException(path + ": expected a number (" + type.Name + ")");
            }
            if (type == typeof(DateTime))
            {
                if (json is string ds && DateTime.TryParse(ds, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dt)) return dt;
                throw new BadArgsException(path + ": expected an ISO 8601 date");
            }
            if (type == typeof(Guid))
            {
                if (json is string gs && Guid.TryParse(gs, out var g)) return g;
                throw new BadArgsException(path + ": expected a GUID string");
            }
            if (type == typeof(Version))
            {
                if (json is string vs && Version.TryParse(vs, out var v)) return v;
                throw new BadArgsException(path + ": expected a version string (1.2.3.4)");
            }
            if (type == typeof(TimeSpan))
            {
                if (json is long || json is double) return TimeSpan.FromMilliseconds(Convert.ToDouble(json, CultureInfo.InvariantCulture));
                throw new BadArgsException(path + ": expected milliseconds");
            }
            if (type == typeof(byte[]) && json is string b64)
            {
                try { return Convert.FromBase64String(b64); }
                catch (FormatException) { throw new BadArgsException(path + ": expected base64"); }
            }
            if (type.IsArray)
            {
                if (!(json is List<object> list)) throw new BadArgsException(path + ": expected an array");
                var elem = type.GetElementType();
                var arr = Array.CreateInstance(elem, list.Count);
                for (var i = 0; i < list.Count; i++) arr.SetValue(ToClr(list[i], elem, path + "[" + i + "]"), i);
                return arr;
            }
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(KeyValuePair<,>))
            {
                if (!(json is Dictionary<string, object> kv)) throw new BadArgsException(path + ": expected { Key, Value }");
                var args = type.GetGenericArguments();
                kv.TryGetValue("Key", out var k);
                kv.TryGetValue("Value", out var v);
                return Activator.CreateInstance(type, ToClr(k, args[0], path + ".Key"), ToClr(v, args[1], path + ".Value"));
            }
            if (type.IsGenericType && ListLike.Contains(type.GetGenericTypeDefinition())) return ToCollection(json, type, path);
            if (type.IsGenericType && (type.GetGenericTypeDefinition() == typeof(Dictionary<,>) || type.GetGenericTypeDefinition() == typeof(IDictionary<,>)))
            {
                var args = type.GetGenericArguments();
                if (args[0] != typeof(string) || !(json is Dictionary<string, object> map)) throw new BadArgsException(path + ": expected an object (" + type.Name + ")");
                var dict = (IDictionary)Activator.CreateInstance(typeof(Dictionary<,>).MakeGenericType(args));
                foreach (var e in map) dict[e.Key] = ToClr(e.Value, args[1], path + "." + e.Key);
                return dict;
            }
            if (json is Dictionary<string, object> obj) return ToObject(obj, type, path);
            throw new BadArgsException(path + ": expected an object (" + type.Name + ")");
        }

        static object ToCollection(object json, Type type, string path)
        {
            if (!(json is List<object> items)) throw new BadArgsException(path + ": expected an array");
            var elem = type.GetGenericArguments()[0];
            var list = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(elem));
            for (var i = 0; i < items.Count; i++) list.Add(ToClr(items[i], elem, path + "[" + i + "]"));
            if (type.IsAssignableFrom(list.GetType())) return list;
            // Collection<T>, ReadOnlyCollection<T>, ObservableCollection<T>: constructors taking an IList<T>/IEnumerable<T>.
            var ctor = type.GetConstructors().FirstOrDefault(c =>
            {
                var ps = c.GetParameters();
                return ps.Length == 1 && ps[0].ParameterType.IsAssignableFrom(list.GetType());
            });
            if (ctor == null) throw new BadArgsException(path + ": cannot build " + type.Name);
            return ctor.Invoke(new object[] { list });
        }

        static object ToObject(Dictionary<string, object> obj, Type type, string path)
        {
            object target;
            var used = new HashSet<string>(StringComparer.Ordinal);
            var parameterless = type.GetConstructor(Type.EmptyTypes);
            if (type.IsValueType) target = Activator.CreateInstance(type); // boxed copy, fields set on it below
            else if (parameterless != null) target = parameterless.Invoke(null);
            else target = Construct(obj, type, path, used);
            foreach (var kv in obj)
            {
                if (used.Contains(kv.Key)) continue;
                var field = type.GetField(kv.Key, BindingFlags.Public | BindingFlags.Instance);
                if (field != null && !field.IsInitOnly)
                {
                    field.SetValue(target, ToClr(kv.Value, field.FieldType, path + "." + kv.Key));
                    continue;
                }
                var prop = type.GetProperty(kv.Key, BindingFlags.Public | BindingFlags.Instance);
                if (prop != null && prop.CanWrite && prop.GetSetMethod() != null && prop.GetIndexParameters().Length == 0)
                {
                    prop.SetValue(target, ToClr(kv.Value, prop.PropertyType, path + "." + kv.Key), null);
                    continue;
                }
                throw new BadArgsException(path + "." + kv.Key + ": unknown or read-only member of " + type.Name);
            }
            return target;
        }

        /// <summary>
        /// Classes without a parameterless constructor (the DCNM data classes): use the public constructor whose parameters
        /// all appear in the object (names case-insensitive; optional parameters may be missing), preferring the one that
        /// consumes the most members. Consumed member names are added to <paramref name="used"/>.
        /// </summary>
        static object Construct(Dictionary<string, object> obj, Type type, string path, HashSet<string> used)
        {
            var keys = obj.Keys.ToDictionary(k => k, k => k, StringComparer.OrdinalIgnoreCase);
            ConstructorInfo best = null;
            var bestCount = -1;
            foreach (var c in type.GetConstructors())
            {
                var ps = c.GetParameters();
                if (!ps.All(p => keys.ContainsKey(p.Name) || p.IsOptional)) continue;
                var count = ps.Count(p => keys.ContainsKey(p.Name));
                if (count > bestCount || (count == bestCount && ps.Length < best.GetParameters().Length)) { best = c; bestCount = count; }
            }
            if (best == null)
            {
                var sigs = type.GetConstructors().Select(c => "(" + string.Join(", ", c.GetParameters().Select(p => p.Name)) + ")");
                throw new BadArgsException(path + ": " + type.Name + " needs the members of one of its constructors: " + string.Join(" | ", sigs));
            }
            var values = best.GetParameters().Select(p =>
            {
                if (!keys.TryGetValue(p.Name, out var key)) return p.DefaultValue is DBNull ? (p.ParameterType.IsValueType ? Activator.CreateInstance(p.ParameterType) : null) : p.DefaultValue;
                used.Add(key);
                return ToClr(obj[key], p.ParameterType, path + "." + key);
            }).ToArray();
            try { return best.Invoke(values); }
            catch (TargetInvocationException ex) { throw new BadArgsException(path + ": " + type.Name + " constructor: " + (ex.InnerException ?? ex).Message); }
        }

        /// <summary>.NET value → JSON-ready tree (Dictionary/List/primitives).</summary>
        public static object FromClr(object value) => FromClr(value, 0);

        static object FromClr(object v, int depth)
        {
            if (v == null) return null;
            var t = v.GetType();
            if (v is string || v is bool) return v;
            if (t.IsEnum)
            {
                var name = Enum.GetName(t, v);
                return name ?? (object)Convert.ToInt64(v, CultureInfo.InvariantCulture);
            }
            if (IsNumber(t)) return v;
            if (v is char c) return c.ToString();
            if (v is DateTime dt) return dt.ToString("o", CultureInfo.InvariantCulture);
            if (v is TimeSpan ts) return ts.TotalMilliseconds;
            if (v is Guid g) return g.ToString();
            if (v is Version ver) return ver.ToString();
            if (v is byte[] bytes) return Convert.ToBase64String(bytes);
            if (depth >= MaxDepth) return v.ToString();
            if (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(KeyValuePair<,>))
            {
                return new Dictionary<string, object>
                {
                    ["Key"] = FromClr(t.GetProperty("Key").GetValue(v, null), depth + 1),
                    ["Value"] = FromClr(t.GetProperty("Value").GetValue(v, null), depth + 1),
                };
            }
            if (v is IDictionary dict)
            {
                var d = new Dictionary<string, object>();
                foreach (DictionaryEntry e in dict) d[Convert.ToString(e.Key, CultureInfo.InvariantCulture)] = FromClr(e.Value, depth + 1);
                return d;
            }
            if (v is IEnumerable list)
            {
                var l = new List<object>();
                foreach (var item in list) l.Add(FromClr(item, depth + 1));
                return l;
            }
            var o = new Dictionary<string, object>();
            foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.Instance)) o[f.Name] = FromClr(f.GetValue(v), depth + 1);
            foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!p.CanRead || p.GetIndexParameters().Length > 0) continue;
                try { o[p.Name] = FromClr(p.GetValue(v, null), depth + 1); }
                catch (Exception ex) { o[p.Name] = "<" + (ex.InnerException ?? ex).GetType().Name + ">"; }
            }
            return o;
        }

        /// <summary>A neutral value for an out parameter the API left unassigned (fake mode).</summary>
        public static object DefaultFor(Type type)
        {
            if (type.IsByRef) type = type.GetElementType();
            if (type.IsArray) return Array.CreateInstance(type.GetElementType(), 0);
            if (type == typeof(string)) return "";
            if (type.IsValueType) return Activator.CreateInstance(type);
            var ctor = type.GetConstructor(Type.EmptyTypes);
            return ctor?.Invoke(null);
        }

        /// <summary>A value of a scalar type for status reports (bool, number, string, enum, Guid, DateTime, Version).</summary>
        public static bool IsScalar(Type t)
        {
            t = Nullable.GetUnderlyingType(t) ?? t;
            return t == typeof(bool) || t == typeof(string) || t.IsEnum || IsNumber(t) || t == typeof(Guid) || t == typeof(DateTime) || t == typeof(Version) || t == typeof(TimeSpan);
        }

        static bool IsInteger(Type t) =>
            t == typeof(int) || t == typeof(long) || t == typeof(short) || t == typeof(byte) || t == typeof(sbyte) ||
            t == typeof(uint) || t == typeof(ulong) || t == typeof(ushort);

        static bool IsNumber(Type t) => IsInteger(t) || t == typeof(double) || t == typeof(float) || t == typeof(decimal);
    }
}
