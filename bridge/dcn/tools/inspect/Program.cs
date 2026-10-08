// DCN-SW DLL inspector (WO-068): metadata only (MetadataLoadContext), nothing from the Bosch assemblies is executed.
// Usage: dotnet run --project bridge/dcn/tools/inspect -- <dll folder> <api.json> <out.json>
// Prints a summary; writes the full surface + comparison with api.json to out.json.
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;

var dir = Path.GetFullPath(args[0]);
var specPath = args[1];
var outPath = args[2];
var refDir = typeof(Program).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().First(a => a.Key == "Net48RefDir").Value;

// ------------------------------------------------------------------ per-assembly PE facts
var assemblies = new List<object>();
foreach (var f in Directory.GetFiles(dir).Where(f => f.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)).OrderBy(f => f))
{
    using var fs = File.OpenRead(f);
    using var pe = new PEReader(fs);
    if (!pe.HasMetadata) { assemblies.Add(new { file = Path.GetFileName(f), managed = false }); continue; }
    var md = pe.GetMetadataReader();
    var def = md.GetAssemblyDefinition();
    var flags = pe.PEHeaders.CorHeader!.Flags;
    assemblies.Add(new
    {
        file = Path.GetFileName(f),
        managed = true,
        name = md.GetString(def.Name),
        version = def.Version.ToString(),
        runtime = md.MetadataVersion,
        machine = pe.PEHeaders.CoffHeader.Machine.ToString(),
        ilOnly = flags.HasFlag(CorFlags.ILOnly),
        requires32Bit = flags.HasFlag(CorFlags.Requires32Bit),
        prefers32Bit = flags.HasFlag(CorFlags.Prefers32Bit),
        references = md.AssemblyReferences.Select(r => { var a = md.GetAssemblyReference(r); return $"{md.GetString(a.Name)} {a.Version}"; }).ToArray(),
    });
}

// ------------------------------------------------------------------ API surface via MetadataLoadContext
var paths = Directory.GetFiles(dir, "*.dll").Concat(Directory.GetFiles(refDir, "*.dll")).Concat(Directory.GetFiles(Path.Combine(refDir, "Facades"), "*.dll"));
using var mlc = new MetadataLoadContext(new PathAssemblyResolver(paths), "mscorlib");
var logic = mlc.LoadFromAssemblyPath(Path.Combine(dir, "Bosch.Dcn.Ecpc.Client.Api.Logic.dll"));
var ifaces = mlc.LoadFromAssemblyPath(Path.Combine(dir, "Bosch.Dcn.Ecpc.Client.Api.Interfaces.dll"));

string N(Type t)
{
    if (t.IsByRef) return N(t.GetElementType()!);
    if (t.IsArray) return N(t.GetElementType()!) + "[]";
    var map = new Dictionary<string, string> { ["System.Int32"] = "int", ["System.Int64"] = "long", ["System.Boolean"] = "bool", ["System.String"] = "string", ["System.Byte"] = "byte",
        ["System.Int16"] = "short", ["System.Double"] = "double", ["System.Object"] = "Object", ["System.Void"] = "void", ["System.EventArgs"] = "EventArgs", ["System.EventHandler"] = "EventHandler", ["System.DateTime"] = "DateTime" };
    if (t.FullName != null && map.TryGetValue(t.FullName, out var k)) return k;
    if (t.IsGenericType) return t.Name.Split('`')[0] + "<" + string.Join(", ", t.GetGenericArguments().Select(N)) + ">";
    return t.Name;
}
// Interface inheritance, collected recursively (MetadataLoadContext flattens only one level: IControlApi → IApi, not IApiEvents).
Type[] All(Type t)
{
    var seen = new List<Type>();
    void Walk(Type x) { if (seen.Any(y => y.FullName == x.FullName)) return; seen.Add(x); foreach (var i in x.GetInterfaces()) Walk(i); }
    Walk(t);
    return seen.ToArray();
}
object Method(MethodInfo m) => new
{
    name = m.Name,
    returns = N(m.ReturnType),
    @params = m.GetParameters().Select(p => new { name = p.Name, direction = p.IsOut ? "out" : p.ParameterType.IsByRef ? "ref" : "in", type = N(p.ParameterType) }).ToArray(),
};
string ArgsOf(Type handler)
{
    var inv = handler.GetMethod("Invoke");
    var ps = inv?.GetParameters();
    return ps is { Length: > 1 } ? N(ps[1].ParameterType) : "EventArgs";
}

var dcnApi = logic.GetType("Bosch.Dcn.Ecpc.Client.Api.Logic.DcnApi", true)!;
var roots = new Dictionary<string, object>();
var subApis = new Dictionary<string, object>();
foreach (var p in dcnApi.GetProperties(BindingFlags.Public | BindingFlags.Static))
{
    var group = p.Name.EndsWith("Api") ? p.Name[..^3].ToLowerInvariant() : p.Name.ToLowerInvariant();
    var rootTypes = All(p.PropertyType);
    roots[group] = new
    {
        property = p.Name, @interface = p.PropertyType.FullName,
        methods = rootTypes.SelectMany(i => i.GetMethods()).Where(m => !m.IsSpecialName).Select(Method).ToArray(),
        events = rootTypes.SelectMany(i => i.GetEvents()).Select(e => new { name = e.Name, handler = N(e.EventHandlerType!) }).ToArray(),
        properties = rootTypes.SelectMany(i => i.GetProperties()).Select(x => new { name = x.Name, type = N(x.PropertyType) }).ToArray(),
    };
    foreach (var sp in rootTypes.SelectMany(i => i.GetProperties()).Where(x => x.PropertyType.IsInterface))
    {
        var st = All(sp.PropertyType).Where(i => i.FullName != "System.IDisposable").ToArray();
        subApis[$"{group}.{sp.Name}"] = new
        {
            @interface = sp.PropertyType.Name,
            methods = st.SelectMany(i => i.GetMethods()).Where(m => !m.IsSpecialName).Select(Method).ToArray(),
            events = st.SelectMany(i => i.GetEvents()).Select(e => new { name = e.Name, handler = N(e.EventHandlerType!), args = ArgsOf(e.EventHandlerType!) }).ToArray(),
            properties = st.SelectMany(i => i.GetProperties()).Select(x => new { name = x.Name, type = N(x.PropertyType) }).ToArray(),
        };
    }
}

// Interfaces with their *declared* members and base interfaces (IApi, IApiEvents, …).
var interfaceTypes = ifaces.GetExportedTypes().Where(t => t.IsInterface).OrderBy(t => t.Name).ToDictionary(t => t.Name, t => (object)new
{
    bases = t.GetInterfaces().Select(i => i.Name).ToArray(),
    methods = t.GetMethods().Where(m => !m.IsSpecialName).Select(m => m.Name).ToArray(),
    events = t.GetEvents().Select(e => $"{e.Name}: {N(e.EventHandlerType!)}").ToArray(),
    properties = t.GetProperties().Select(x => $"{x.Name}: {N(x.PropertyType)}").ToArray(),
});
var types = new Dictionary<string, object>();
foreach (var t in ifaces.GetExportedTypes().Concat(logic.GetExportedTypes()).OrderBy(t => t.Name))
{
    if (t.IsInterface) continue;
    if (t.IsEnum)
    {
        types[t.Name] = new { kind = "enum", values = t.GetFields(BindingFlags.Public | BindingFlags.Static).Select(f => new { name = f.Name, value = Convert.ToInt64(f.GetRawConstantValue()) }).ToArray() };
        continue;
    }
    var kind = t.IsValueType ? "struct" : t.BaseType?.FullName == "System.MulticastDelegate" ? "delegate" : "class";
    types[t.Name] = new
    {
        kind,
        @namespace = t.Namespace,
        baseType = t.BaseType == null ? null : N(t.BaseType),
        fields = t.GetFields(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly).Select(f => new
        {
            name = f.Name, type = N(f.FieldType), @static = f.IsStatic, literal = f.IsLiteral, readOnly = f.IsInitOnly,
            value = f.IsLiteral ? f.GetRawConstantValue()?.ToString() : null,
        }).ToArray(),
        properties = t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Select(x => new { name = x.Name, type = N(x.PropertyType), get = x.CanRead, set = x.SetMethod?.IsPublic == true }).ToArray(),
        constructors = t.GetConstructors().Select(c => c.GetParameters().Select(p => $"{N(p.ParameterType)} {p.Name}").ToArray()).ToArray(),
        invoke = kind == "delegate" ? Method(t.GetMethod("Invoke")!) : null,
    };
}

// ------------------------------------------------------------------ remoting / WCF references and telling strings
object Scan(string file)
{
    using var fs = File.OpenRead(Path.Combine(dir, file));
    using var pe = new PEReader(fs);
    var md = pe.GetMetadataReader();
    string TypeRefName(EntityHandle h) => h.Kind == HandleKind.TypeReference
        ? $"{md.GetString(md.GetTypeReference((TypeReferenceHandle)h).Namespace)}.{md.GetString(md.GetTypeReference((TypeReferenceHandle)h).Name)}" : h.Kind.ToString();
    var typeRefs = md.TypeReferences.Select(h => TypeRefName(h)).Where(n => n.Contains("Remoting") || n.Contains("ServiceModel") || n.Contains("Channels") || n.Contains("Configuration")).Distinct().OrderBy(x => x).ToArray();
    var memberRefs = md.MemberReferences.Select(h => md.GetMemberReference(h)).Select(r => $"{TypeRefName(r.Parent)}::{md.GetString(r.Name)}")
        .Where(n => n.Contains("Remoting") || n.Contains("ServiceModel") || n.Contains("Channel") || n.Contains("Configuration") || n.Contains("Activator::") || n.Contains("RemotingServices") || n.Contains("Marshal")).Distinct().OrderBy(x => x).ToArray();
    var strings = new List<string>();
    var heap = md.GetHeapSize(HeapIndex.UserString);
    for (var off = 1; off < heap;)
    {
        var h = MetadataTokens.UserStringHandle(off);
        var s = md.GetUserString(h);
        strings.Add(s);
        var next = md.GetNextHandle(h);
        if (next.IsNil) break;
        off = MetadataTokens.GetHeapOffset(next);
    }
    var allMemberRefs = md.MemberReferences.Select(h => md.GetMemberReference(h)).Select(r => $"{TypeRefName(r.Parent)}::{md.GetString(r.Name)}").Distinct().OrderBy(x => x).ToArray();
    var allTypeRefs = md.TypeReferences.Select(h => TypeRefName(h)).Distinct().OrderBy(x => x).ToArray();
    return new { file, typeRefs, memberRefs, allTypeRefs, allMemberRefs, strings = strings.Where(s => s.Length > 2).Distinct().ToArray() };
}
// The API DLLs plus the Bosch libraries they reference (channel registration may live there).
var scanFiles = new[] { "Bosch.Dcn.Ecpc.Client.Api.Logic.dll", "Bosch.Dcn.Ecpc.Client.Api.Services.dll", "Bosch.Dcn.Ecpc.Client.Api.Interfaces.dll",
    "Bosch.Dcn.Operational.dll", "Bosch.Dcn.Ecpc.Operational.DLL", "Bosch.Operational.dll", "Bosch.Dcn.Ecpc.Client.Interfaces.DLL", "Bosch.Dcn.Ecpc.Server.Interfaces.DLL", "Bosch.Dcn.Ecpc.Client.DLL", "Bosch.Dcn.Ecpc.Client.Logic.DLL" };
var scans = scanFiles.Where(f => File.Exists(Path.Combine(dir, f)))
    .Concat(Directory.GetFiles(dir, "*.dll").Concat(Directory.GetFiles(dir, "*.DLL")).Select(Path.GetFileName).Where(f => !scanFiles.Contains(f)).Distinct(StringComparer.OrdinalIgnoreCase))
    .Select(f => { try { return Scan(f); } catch { return null; } }).Where(x => x != null).ToArray();

// ------------------------------------------------------------------ compare with api.json
var spec = JsonDocument.Parse(File.ReadAllText(specPath)).RootElement;
var diffs = new List<string>();
foreach (var iface in spec.GetProperty("interfaces").EnumerateObject())
{
    if (!subApis.TryGetValue(iface.Name, out var realObj)) { diffs.Add($"MISSING interface {iface.Name}"); continue; }
    var real = JsonSerializer.SerializeToElement(realObj);
    var realMethods = real.GetProperty("methods").EnumerateArray().ToDictionary(m => m.GetProperty("name").GetString()!);
    foreach (var m in iface.Value.GetProperty("methods").EnumerateArray())
    {
        var name = m.GetProperty("name").GetString()!;
        if (!realMethods.TryGetValue(name, out var rm)) { diffs.Add($"MISSING method {iface.Name}.{name}"); continue; }
        string Sig(JsonElement ps) => string.Join(", ", ps.EnumerateArray().Select(p => $"{p.GetProperty("direction").GetString()} {p.GetProperty("type").GetString()} {p.GetProperty("name").GetString()}"));
        var a = Sig(m.GetProperty("params")); var b = Sig(rm.GetProperty("params"));
        if (a != b) diffs.Add($"PARAMS {iface.Name}.{name}: docs ({a}) vs DLL ({b})");
        if (rm.GetProperty("returns").GetString() != "API_ERROR") diffs.Add($"RETURNS {iface.Name}.{name}: {rm.GetProperty("returns").GetString()}");
    }
    var docMethods = iface.Value.GetProperty("methods").EnumerateArray().Select(m => m.GetProperty("name").GetString()).ToHashSet();
    foreach (var extra in realMethods.Keys.Where(k => !docMethods.Contains(k))) diffs.Add($"EXTRA method {iface.Name}.{extra}: {JsonSerializer.Serialize(realMethods[extra])}");
    var realEvents = real.GetProperty("events").EnumerateArray().ToDictionary(e => e.GetProperty("name").GetString()!);
    foreach (var e in iface.Value.GetProperty("events").EnumerateArray())
    {
        var name = e.GetProperty("name").GetString()!;
        if (!realEvents.TryGetValue(name, out var re)) { diffs.Add($"MISSING event {iface.Name}.{name}"); continue; }
        var docArgs = e.GetProperty("args").GetString(); var realArgs = re.GetProperty("args").GetString();
        if (docArgs != realArgs) diffs.Add($"EVENT ARGS {iface.Name}.{name}: docs {docArgs} vs DLL {realArgs}");
    }
    var docEvents = iface.Value.GetProperty("events").EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToHashSet();
    foreach (var extra in realEvents.Keys.Where(k => !docEvents.Contains(k))) diffs.Add($"EXTRA event {iface.Name}.{extra}");
}
foreach (var extra in subApis.Keys.Where(k => !spec.GetProperty("interfaces").TryGetProperty(k, out _))) diffs.Add($"EXTRA interface {extra}");

var report = new { dir, assemblies, roots, subApis, interfaceTypes, types, scans, diffs };
File.WriteAllText(outPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"{assemblies.Count} DLLs; API version {logic.GetName().Version}; {roots.Count} roots, {subApis.Count} interfaces, {types.Count} types");
Console.WriteLine($"{diffs.Count} difference(s) to api.json:");
foreach (var d in diffs) Console.WriteLine("  " + d);
