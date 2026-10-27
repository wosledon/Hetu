using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Services.Work;

namespace Hetu.Core.Tests;

public class SshSessionTests
{
    private const string Marker = "0123456789abcdef0123456789abcdef";

    private static WorkProject Project(string host = "10.60.33.24", string user = "bsi", int port = 22)
        => new()
        {
            Id = Guid.NewGuid(),
            Name = "test",
            RootPath = "/home/bsi/repos/app",
            ConnectionType = "Ssh",
            SshHost = host,
            SshPort = port,
            SshUser = user,
            SshAuthType = "Key",
        };

    // ---------- stdout 逐字节还原 ----------

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("abc\n")]
    [InlineData("abc\n\n")]
    [InlineData("a\nb\nc\n")]
    [InlineData("a\nb\nc")]
    [InlineData("line with  spaces\tand tabs\n")]
    public void JoinStdout_任意换行形态都逐字节还原(string stdout)
    {
        // 框架在标记行前补的 '\n' 抵消命令 stdout 末行的终止符，行表直接拼接即还原
        var lines = new List<string>(stdout.Split('\n'));
        Assert.Equal(stdout, SshProtocol.JoinStdout(lines));
    }

    // ---------- 框架化读取 ----------

    [Fact]
    public async Task ReadFramedResult_标准输出与退出码正确解析()
    {
        var stream = "uat\n" + $"\n{SshProtocol.ErrPrefix}{Marker} \n" + $"{SshProtocol.DonePrefix}{Marker} 0\n";
        var result = await SshSession.ReadFramedResultAsync(new StringReader(stream), Marker, CancellationToken.None);

        Assert.Equal(0, result.ExitCode);
        Assert.Equal("uat\n", result.StdOut);
        Assert.Equal(string.Empty, result.StdErr);
    }

    [Fact]
    public async Task ReadFramedResult_stderr经base64分离带回不污染stdout()
    {
        var stderr = "fatal: not a git repository\nsecond line";
        var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(stderr));
        var stream = "out-1\nout-2\n" + $"\n{SshProtocol.ErrPrefix}{Marker} {b64}\n" + $"{SshProtocol.DonePrefix}{Marker} 128\n";

        var result = await SshSession.ReadFramedResultAsync(new StringReader(stream), Marker, CancellationToken.None);

        Assert.Equal(128, result.ExitCode);
        Assert.Equal("out-1\nout-2\n", result.StdOut);
        Assert.Equal(stderr, result.StdErr);
    }

    [Fact]
    public async Task ReadFramedResult_输出里出现形似标记的行时按标记精确匹配()
    {
        // 别的命令的标记 / 少了空格的近亲都不算当前命令的结束标记
        var stream = $"HETU_DONE_othermarker 0\nHETU_DONE_{Marker}99\n"
            + $"\n{SshProtocol.ErrPrefix}{Marker} \n" + $"{SshProtocol.DonePrefix}{Marker} 0\n";

        var result = await SshSession.ReadFramedResultAsync(new StringReader(stream), Marker, CancellationToken.None);

        Assert.Equal(0, result.ExitCode);
        Assert.Equal($"HETU_DONE_othermarker 0\nHETU_DONE_{Marker}99\n", result.StdOut);
    }

    [Fact]
    public async Task ReadFramedResult_连接中途断开抛EndOfStreamException()
    {
        var stream = "partial output\n";
        await Assert.ThrowsAsync<EndOfStreamException>(()
            => SshSession.ReadFramedResultAsync(new StringReader(stream), Marker, CancellationToken.None));
    }

    // ---------- 命令脚本构造 ----------

    [Fact]
    public void BuildCommandScript_无stdin时用命令替换分离stderr并带上标记()
    {
        var script = SshProtocol.BuildCommandScript("cd '/root' && git rev-parse --abbrev-ref HEAD", Marker, null);

        Assert.Contains("ERR=$( { cd '/root' && git rev-parse --abbrev-ref HEAD; } 2>&1 1>&3 )", script);
        Assert.Contains($"printf '{SshProtocol.DonePrefix}{Marker} %s\\n'", script);
        Assert.DoesNotContain("base64 -d", script);
    }

    [Fact]
    public void BuildCommandScript_stdin负载base64化后经管道喂给命令()
    {
        const string payload = "fix: 支持中文提交信息\n第二行";
        var script = SshProtocol.BuildCommandScript("cd '/root' && git commit -F -", Marker, payload);

        // 脚本里的 base64 块解码后必须与原始负载逐字节一致
        var chunks = ExtractQuotedArgs(script, "printf '%s\\n'");
        Assert.NotEmpty(chunks);
        var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(string.Concat(chunks)));
        Assert.Equal(payload, decoded);
        Assert.Contains("| base64 -d | { cd '/root' && git commit -F -; }", script);
    }

    [Fact]
    public void BuildCommandScript_空stdin不注入多余换行()
    {
        var script = SshProtocol.BuildCommandScript("cd '/root' && cat > file.txt", Marker, "");

        Assert.Contains("printf '' | base64 -d", script);
        Assert.DoesNotContain("printf '%s\\n'", script);
    }

    [Fact]
    public void BuildCommandScript_大stdin分块且拼回完整base64()
    {
        var payload = new string('x', 120_000);
        var script = SshProtocol.BuildCommandScript("cd '/root' && cat > big.bin", Marker, payload);

        var chunks = ExtractQuotedArgs(script, "printf '%s\\n'");
        Assert.True(chunks.Count > 1, "大负载应分块，避免超长单行");
        Assert.All(chunks, c => Assert.True(c.Length <= 4000));
        Assert.Equal(Convert.ToBase64String(Encoding.UTF8.GetBytes(payload)), string.Concat(chunks));
    }

    [Fact]
    public void BuildCommandScript_输出里的行不可能被误判为标记()
    {
        // 标记是 32 位十六进制 GUID，命令输出撞上的概率可忽略；这里验证标记格式本身
        var script = SshProtocol.BuildCommandScript("echo hi", Marker, null);
        Assert.Contains($"{SshProtocol.DonePrefix}{Marker} ", script);
        Assert.Contains($"{SshProtocol.ErrPrefix}{Marker} ", script);
    }

    // ---------- 建立脚本与 ssh 参数 ----------

    [Fact]
    public void BuildSetupScript_dupFd3并探测base64可用性()
    {
        var script = SshProtocol.BuildSetupScript(Marker);

        Assert.Contains("exec 3>&1", script);
        Assert.Contains($"printf '{SshProtocol.Fd3Probe}' >&3", script);
        Assert.Contains($"command -v base64", script);
        Assert.Contains($"{SshProtocol.SetupPrefix}{Marker}", script);
    }

    [Fact]
    public void BuildSshArgs_带端口保活与登录目标()
    {
        var args = SshProtocol.BuildSshArgs(Project(port: 22223));

        Assert.Contains("-p 22223", args);
        Assert.Contains("-o BatchMode=yes", args);
        Assert.Contains("-o ServerAliveInterval=5 -o ServerAliveCountMax=3", args);
        Assert.EndsWith("bsi@10.60.33.24", args);
    }

    [Fact]
    public void BuildSshArgs_指定了密钥路径才带i参数()
    {
        var withKey = Project();
        withKey.SshKeyPath = @"C:\keys\id_ed25519";
        Assert.Contains("-i \"C:\\keys\\id_ed25519\"", SshProtocol.BuildSshArgs(withKey));
        Assert.DoesNotContain("-i ", SshProtocol.BuildSshArgs(Project()));
    }

    [Fact]
    public void ConnectionSignature_同连接同签名_改项目或根目录不影响()
    {
        var a = Project();
        var b = Project();
        b.Id = Guid.NewGuid();
        b.Name = "另一个项目";
        b.RootPath = "/home/bsi/repos/other";
        Assert.Equal(SshProtocol.ConnectionSignature(a), SshProtocol.ConnectionSignature(b));

        var other = Project(host: "47.112.206.145", user: "ledon", port: 22223);
        Assert.NotEqual(SshProtocol.ConnectionSignature(a), SshProtocol.ConnectionSignature(other));
    }

    [Fact]
    public void EphemeralProjectId_同连接派生同Id_不同连接互不相同()
    {
        var a = Project();
        var b = Project();
        b.RootPath = "/home/bsi/repos/other";   // 浏览目录时同一连接会换着路径列举
        Assert.Equal(SshProtocol.EphemeralProjectId(a), SshProtocol.EphemeralProjectId(b));

        var other = Project(host: "47.112.206.145", user: "ledon", port: 22223);
        Assert.NotEqual(SshProtocol.EphemeralProjectId(a), SshProtocol.EphemeralProjectId(other));
        // 与真实项目的随机 Id 不会相撞
        Assert.NotEqual(Project().Id, SshProtocol.EphemeralProjectId(Project()));
    }

    // ---------- 标记行判定 ----------

    [Fact]
    public void ShouldReap_空闲超时且无命令在飞才回收()
    {
        var now = DateTime.UtcNow;
        var idle = now - SshSessionManager.IdleTimeout - TimeSpan.FromSeconds(1);

        Assert.True(SshSessionManager.ShouldReap(idle, busy: false, now));
        Assert.False(SshSessionManager.ShouldReap(now - TimeSpan.FromSeconds(5), busy: false, now), "未闲够不回收");
        Assert.False(SshSessionManager.ShouldReap(idle, busy: true, now), "命令在飞不回收");
    }

    [Fact]
    public void IsDoneLine_仅完整前缀加数字才算结束标记()
    {
        Assert.True(SshProtocol.IsDoneLine($"{SshProtocol.DonePrefix}{Marker} 0", Marker, out var code));
        Assert.Equal(0, code);
        Assert.True(SshProtocol.IsDoneLine($"{SshProtocol.DonePrefix}{Marker} 255", Marker, out var code2));
        Assert.Equal(255, code2);
        Assert.False(SshProtocol.IsDoneLine($"{SshProtocol.DonePrefix}{Marker} notanumber", Marker, out _));
        Assert.False(SshProtocol.IsDoneLine($"{SshProtocol.DonePrefix}{Marker}", Marker, out _));
    }

    [Fact]
    public void DecodeBase64_非法内容返回null而非抛异常()
    {
        Assert.Null(SshProtocol.DecodeBase64("!!!not-base64!!!"));
        Assert.Equal(string.Empty, SshProtocol.DecodeBase64(""));
        Assert.Equal("ok", SshProtocol.DecodeBase64(Convert.ToBase64String("ok"u8.ToArray())));
    }

    /// <summary>取出脚本中 <c>printf '%s\n' 'a' 'b'</c> 形式的各单引号参数</summary>
    private static List<string> ExtractQuotedArgs(string script, string prefix)
    {
        var start = script.IndexOf(prefix, StringComparison.Ordinal);
        Assert.True(start >= 0, "脚本里应包含 " + prefix);
        var rest = script[(start + prefix.Length)..];
        var end = rest.IndexOf(" | base64 -d", StringComparison.Ordinal);
        Assert.True(end >= 0, "base64 块后应接到 base64 -d");
        rest = rest[..end];
        var args = new List<string>();
        var i = 0;
        while (i < rest.Length)
        {
            if (rest[i] != '\'') { i++; continue; }
            var close = i + 1;
            var sb = new StringBuilder();
            while (close < rest.Length && rest[close] != '\'')
            {
                if (rest[close] == '\\' && close + 1 < rest.Length && rest[close + 1] == '\'')
                {
                    sb.Append('\'');
                    close += 2;
                    continue;
                }
                sb.Append(rest[close]);
                close++;
            }
            args.Add(sb.ToString());
            i = close + 1;
        }
        return args;
    }
}
