using Hetu.Core.Services.Work;

namespace Hetu.Core.Tests;

public class SshConfigFileTests
{
    [Fact]
    public void ResolveUser_按HostName匹配到别名块时返回该块User()
    {
        var path = WriteConfig("""
            Host home
              HostName 192.168.1.4
              User ledon

            Host direct
              HostName 111.228.59.134
              User root
            """);

        try
        {
            Assert.Equal("ledon", SshConfigFile.ResolveUser("192.168.1.4", path));
            Assert.Equal("root", SshConfigFile.ResolveUser("111.228.59.134", path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void ResolveUser_主机是别名时按别名匹配返回User()
    {
        var path = WriteConfig("""
            Host home
              HostName 192.168.1.4
              User ledon
            """);

        try
        {
            Assert.Equal("ledon", SshConfigFile.ResolveUser("home", path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void ResolveUser_没有匹配块或块无User时返回null()
    {
        var path = WriteConfig("""
            Host home
              HostName 192.168.1.4
              User ledon

            Host nouser
              HostName 10.0.0.1
            """);

        try
        {
            Assert.Null(SshConfigFile.ResolveUser("8.8.8.8", path));
            Assert.Null(SshConfigFile.ResolveUser("10.0.0.1", path));
            Assert.Null(SshConfigFile.ResolveUser(null, path));
            Assert.Null(SshConfigFile.ResolveUser("192.168.1.4", Path.Combine(Path.GetTempPath(), $"hetu-missing-{Guid.NewGuid():N}")));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_忽略通配符块并展开Include()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"hetu-sshcfg-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var included = Path.Combine(dir, "extra");
        File.WriteAllText(included, """
            Host cloud
              HostName 1.2.3.4
              User ops
            """);
        var main = Path.Combine(dir, "config");
        File.WriteAllText(main, """
            Host *
              User nobody

            Include extra
            """);

        try
        {
            var hosts = SshConfigFile.Load(main);
            Assert.DoesNotContain(hosts, h => h.Alias == "*");
            var cloud = Assert.Single(hosts, h => h.Alias == "cloud");
            Assert.Equal("1.2.3.4", cloud.HostName);
            Assert.Equal("ops", cloud.User);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    private static string WriteConfig(string content)
    {
        var path = Path.Combine(Path.GetTempPath(), $"hetu-sshcfg-{Guid.NewGuid():N}");
        File.WriteAllText(path, content);
        return path;
    }
}
