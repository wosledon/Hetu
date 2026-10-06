using System.Diagnostics;
using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Services.Work;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>SSH 客户端探测与远程连接测试（远程项目使用系统 ssh 命令，无需内嵌 SSH）</summary>
[ApiController]
[Route("api/work/ssh")]
public class WorkSshController : ControllerBase
{
    private readonly IDataProtectionProvider _dataProtection;

    public WorkSshController(IDataProtectionProvider dataProtection)
    {
        _dataProtection = dataProtection;
    }

    /// <summary>探测本机 ssh 客户端是否可用，并给出安装引导</summary>
    [HttpGet("status")]
    public Task<ApiResponse<WorkSshStatusDto>> Status()
    {
        var status = new WorkSshStatusDto { Os = DescribeOs() };
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "ssh",
                Arguments = "-V",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var process = Process.Start(psi);
            if (process != null)
            {
                var output = process.StandardError.ReadToEnd() + process.StandardOutput.ReadToEnd();
                process.WaitForExit(5000);
                status.Available = true;
                status.Version = output.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
            }
        }
        catch
        {
            status.Available = false;
        }

        if (!status.Available)
        {
            status.InstallHint = OperatingSystem.IsWindows()
                ? "未检测到 ssh 命令。请安装 OpenSSH 客户端：设置 → 系统 → 可选功能 → 添加功能 → 搜索 “OpenSSH 客户端”；或安装 Git for Windows（自带 ssh）。"
                : OperatingSystem.IsMacOS()
                    ? "未检测到 ssh 命令。macOS 通常自带，如缺失请安装 Xcode 命令行工具：xcode-select --install。"
                    : "未检测到 ssh 命令。请安装 OpenSSH 客户端：Debian/Ubuntu 执行 sudo apt install openssh-client；RHEL/Fedora 执行 sudo dnf install openssh-clients。";
            status.InstallUrl = OperatingSystem.IsWindows()
                ? "https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_first_use"
                : "https://www.openssh.com/manual.html";
        }
        return Task.FromResult(ApiResponse<WorkSshStatusDto>.Ok(status));
    }

    /// <summary>测试 SSH 连通性：执行远端 whoami + pwd 验证登录与目录可达</summary>
    [HttpPost("test")]
    public async Task<ApiResponse<WorkSshTestResultDto>> Test([FromBody] WorkSshTestRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Host))
            return ApiResponse<WorkSshTestResultDto>.Fail("主机地址不能为空");

        var project = new WorkProject
        {
            Id = Guid.NewGuid(),
            Name = request.Name ?? "ssh-test",
            RootPath = string.IsNullOrWhiteSpace(request.RootPath) ? "~" : request.RootPath!.Trim(),
            ConnectionType = "Ssh",
            SshHost = request.Host.Trim(),
            SshPort = request.Port <= 0 ? 22 : request.Port,
            SshUser = request.User,
            SshAuthType = string.IsNullOrWhiteSpace(request.AuthType) ? "Key" : request.AuthType!,
            SshKeyPath = request.KeyPath,
            SshPasswordProtected = string.IsNullOrEmpty(request.Password) ? null : Protect(request.Password),
        };

        string? Decrypt(string v) =>
            string.IsNullOrEmpty(v) ? null : Encoding.UTF8.GetString(_dataProtection.CreateProtector("Hetu.Ssh").Unprotect(Convert.FromBase64String(v)));

        var runner = new SshCommandRunner(project, Decrypt);
        try
        {
            var who = await runner.RunAsync("whoami", cancellationToken);
            if (who.ExitCode != 0)
                return ApiResponse<WorkSshTestResultDto>.Ok(new WorkSshTestResultDto
                {
                    Success = false,
                    Message = $"连接失败：{FirstLine(who.StdErr) ?? "未知错误"}",
                });

            var pwd = await runner.RunAsync("pwd", cancellationToken);
            var banner = pwd.ExitCode == 0 ? pwd.StdOut.Trim() : who.StdOut.Trim();
            return ApiResponse<WorkSshTestResultDto>.Ok(new WorkSshTestResultDto
            {
                Success = true,
                Message = $"连接成功：{who.StdOut.Trim()}@{request.Host}",
                RemoteBanner = banner,
            });
        }
        catch (Exception ex)
        {
            return ApiResponse<WorkSshTestResultDto>.Ok(new WorkSshTestResultDto { Success = false, Message = $"连接异常：{ex.Message}" });
        }
    }

    private string Protect(string password)
        => Convert.ToBase64String(_dataProtection.CreateProtector("Hetu.Ssh").Protect(Encoding.UTF8.GetBytes(password)));

    private static string DescribeOs() => OperatingSystem.IsWindows() ? "Windows" : OperatingSystem.IsMacOS() ? "macOS" : "Linux";

    private static string? FirstLine(string text) => text.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
}

public class WorkSshTestRequest
{
    public string? Name { get; set; }
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 22;
    public string? User { get; set; }
    public string? AuthType { get; set; }
    public string? KeyPath { get; set; }
    public string? Password { get; set; }
    public string? RootPath { get; set; }
}
