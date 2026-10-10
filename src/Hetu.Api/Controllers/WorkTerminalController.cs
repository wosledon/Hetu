using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Hetu.Api.Services;
using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>工作终端：WebSocket 双向通道，伪终端运行在本地或 SSH 远程主机</summary>
[ApiController]
[Route("api/work-terminal")]
public class WorkTerminalController : ControllerBase
{
    private readonly WorkTerminalManager _manager;
    private readonly ILocalizer _localizer;

    public WorkTerminalController(WorkTerminalManager manager, ILocalizer localizer)
    {
        _manager = manager;
        _localizer = localizer;
    }

    [HttpGet("{projectId:guid}/connect")]
    public async Task Connect(Guid projectId, [FromQuery] int cols, [FromQuery] int rows, CancellationToken ct)
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest)
        {
            HttpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var (session, error) = await _manager.GetOrCreateAsync(projectId, cols <= 0 ? 80 : cols, rows <= 0 ? 24 : rows, ct);
        if (session == null)
        {
            HttpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await HttpContext.Response.WriteAsync(error ?? _localizer.T("work.terminalInitFailed"), ct);
            return;
        }

        using var webSocket = await HttpContext.WebSockets.AcceptWebSocketAsync();
        var buffer = new byte[4096];
        var sendLock = new SemaphoreSlim(1, 1);

        // 输出 → WebSocket（文本帧）
        var outputTask = Task.Run(async () =>
        {
            try
            {
                await foreach (var chunk in session.Output.ReadAllAsync(ct))
                {
                    var payload = Encoding.UTF8.GetBytes(chunk);
                    await sendLock.WaitAsync(ct);
                    try
                    {
                        if (webSocket.State == WebSocketState.Open)
                            await webSocket.SendAsync(new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, ct);
                    }
                    finally { sendLock.Release(); }
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
            catch (ObjectDisposedException) { }
        }, ct);

        // WebSocket → 输入：二进制帧为键盘数据，文本帧为 JSON 控制
        try
        {
            while (webSocket.State == WebSocketState.Open)
            {
                var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.Count == 0) continue;

                if (result.MessageType == WebSocketMessageType.Binary)
                {
                    session.Write(Encoding.UTF8.GetString(buffer, 0, result.Count));
                }
                else
                {
                    var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    try
                    {
                        using var doc = JsonDocument.Parse(text);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("t", out var t) && t.GetString() == "resize")
                        {
                            session.Resize(root.GetProperty("cols").GetInt32(), root.GetProperty("rows").GetInt32());
                        }
                    }
                    catch (JsonException) { /* 非 JSON 文本按键盘输入兜底 */ session.Write(text); }
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        finally
        {
            ct.ThrowIfCancellationRequested();
            try { await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None); } catch { }
            await Task.WhenAny(outputTask, Task.Delay(500));
        }
    }

    [HttpPost("{projectId:guid}/stop")]
    public async Task<IActionResult> Stop(Guid projectId)
    {
        await _manager.StopAsync(projectId);
        return Ok(new { success = true });
    }
}
