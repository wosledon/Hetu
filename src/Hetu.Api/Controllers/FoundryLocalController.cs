using Hetu.Api.Streaming;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;
using Hetu.Shared.Common;
using Hetu.Shared.FoundryLocal;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// Foundry Local 本地模型运行时管理面。对应 `foundry` CLI 的 model / service / cache 三组命令。
/// </summary>
[ApiController]
[Route("api/foundry-local")]
public class FoundryLocalController : ControllerBase
{
    private readonly IFoundryLocalService _service;
    private readonly ILocalizer _localizer;

    public FoundryLocalController(IFoundryLocalService service, ILocalizer localizer)
    {
        _service = service;
        _localizer = localizer;
    }

    /// <summary>运行时状态：平台支持性、端点、模型保存路径、已加载/已缓存数量</summary>
    [HttpGet("status")]
    public async Task<ApiResponse<FoundryLocalStatusDto>> Status(CancellationToken cancellationToken)
        => ApiResponse<FoundryLocalStatusDto>.Ok(await _service.GetStatusAsync(cancellationToken));

    /// <summary>模型目录；cachedOnly=true 只返回本地已下载的</summary>
    [HttpGet("models")]
    public async Task<ApiResponse<List<FoundryLocalModelDto>>> Models([FromQuery] bool cachedOnly = false, CancellationToken cancellationToken = default)
        => ApiResponse<List<FoundryLocalModelDto>>.Ok(await _service.GetModelsAsync(cachedOnly, cancellationToken));

    /// <summary>当前已加载（常驻内存）的模型</summary>
    [HttpGet("models/loaded")]
    public async Task<ApiResponse<List<FoundryLocalModelDto>>> LoadedModels(CancellationToken cancellationToken)
        => ApiResponse<List<FoundryLocalModelDto>>.Ok(await _service.GetLoadedModelsAsync(cancellationToken));

    /// <summary>下载模型，进度经 SSE 推送</summary>
    [HttpPost("models/{id}/download")]
    public async Task Download(string id, CancellationToken cancellationToken)
    {
        Response.StartSseStream();
        var writer = new SseStreamWriter(Response, cancellationToken);
        var progress = new Progress<double>(p => _ = writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto
        {
            Alias = id,
            Progress = p,
            State = "downloading",
        }));

        try
        {
            await _service.DownloadAsync(id, progress, cancellationToken);
            await writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto
            {
                Alias = id,
                Progress = 1,
                State = "completed",
            });
        }
        catch (OperationCanceledException)
        {
            await writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto
            {
                Alias = id,
                State = "cancelled",
            });
        }
        catch (Exception ex)
        {
            // 不向客户端泄漏堆栈，只给首行消息
            await writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto
            {
                Alias = id,
                State = "failed",
                Error = ex.Message.Split('\n')[0],
            });
        }
    }

    /// <summary>加载进内存</summary>
    [HttpPost("models/{id}/load")]
    public async Task<ActionResult<ApiResponse>> Load(string id, CancellationToken cancellationToken)
    {
        try
        {
            await _service.LoadAsync(id, cancellationToken);
            return Ok(ApiResponse.Ok());
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse.Fail(ex.Message.Split('\n')[0]));
        }
    }

    /// <summary>从内存卸载</summary>
    [HttpPost("models/{id}/unload")]
    public async Task<ActionResult<ApiResponse>> Unload(string id, CancellationToken cancellationToken)
    {
        await _service.UnloadAsync(id, cancellationToken);
        return Ok(ApiResponse.Ok());
    }

    /// <summary>删除本地缓存</summary>
    [HttpDelete("models/{id}")]
    public async Task<ActionResult<ApiResponse>> Remove(string id, CancellationToken cancellationToken)
    {
        await _service.RemoveFromCacheAsync(id, cancellationToken);
        return Ok(ApiResponse.Ok());
    }

    /// <summary>把模型注册成 Hetu 的 Provider 模型，返回 AiModel Id</summary>
    [HttpPost("models/{id}/register")]
    public async Task<ActionResult<ApiResponse<Guid>>> Register(string id, [FromQuery] string purpose = "chat", CancellationToken cancellationToken = default)
    {
        try
        {
            var modelId = await _service.RegisterAsProviderModelAsync(id, purpose, cancellationToken);
            return Ok(ApiResponse<Guid>.Ok(modelId));
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse<Guid>.Fail(ex.Message.Split('\n')[0]));
        }
    }

    /// <summary>下载并注册执行提供程序（GPU/NPU 后端），进度经 SSE 推送</summary>
    [HttpPost("execution-providers/download")]
    public async Task DownloadExecutionProviders(CancellationToken cancellationToken)
    {
        Response.StartSseStream();
        var writer = new SseStreamWriter(Response, cancellationToken);
        var progress = new Progress<double>(p => _ = writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto
        {
            Alias = "__ep__",
            Progress = p,
            State = "downloading",
        }));

        try
        {
            await _service.DownloadAndRegisterExecutionProvidersAsync(progress, cancellationToken);
            await writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto
            {
                Alias = "__ep__",
                Progress = 100,
                State = "completed",
            });
        }
        catch (OperationCanceledException)
        {
            await writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto { Alias = "__ep__", State = "cancelled" });
        }
        catch (Exception ex)
        {
            await writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto
            {
                Alias = "__ep__",
                State = "failed",
                Error = ex.Message.Split('\n')[0],
            });
        }
    }

    /// <summary>启动 OpenAI 兼容 Web 服务</summary>
    [HttpPost("service/start")]    public async Task<ActionResult<ApiResponse>> StartService(CancellationToken cancellationToken)
    {
        try
        {
            await _service.StartServiceAsync(cancellationToken);
            return Ok(ApiResponse.Ok());
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse.Fail(ex.Message.Split('\n')[0]));
        }
    }

    /// <summary>停止 Web 服务</summary>
    [HttpPost("service/stop")]
    public async Task<ActionResult<ApiResponse>> StopService(CancellationToken cancellationToken)
    {
        await _service.StopServiceAsync(cancellationToken);
        return Ok(ApiResponse.Ok());
    }

    /// <summary>设置模型保存路径；传空恢复默认。改完会重建运行时</summary>
    [HttpPut("model-dir")]
    public async Task<ActionResult<ApiResponse<string>>> SetModelDir([FromBody] UpdateFoundryLocalModelDirRequest request, CancellationToken cancellationToken)
    {
        var path = request?.Path?.Trim();
        if (!string.IsNullOrWhiteSpace(path))
        {
            if (!Path.IsPathFullyQualified(path))
                return BadRequest(ApiResponse<string>.Fail(_localizer.T("foundry.modelDirNotAbsolute")));
            try
            {
                Directory.CreateDirectory(path);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException or ArgumentException)
            {
                return BadRequest(ApiResponse<string>.Fail(_localizer.T("foundry.modelDirInvalid", ex.Message.Split('\n')[0])));
            }
        }

        var applied = await _service.SetModelDirAsync(string.IsNullOrWhiteSpace(path) ? null : path, cancellationToken);
        return Ok(ApiResponse<string>.Ok(applied));
    }
}
