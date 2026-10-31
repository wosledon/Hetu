using Hetu.Api.Streaming;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;
using Hetu.Shared.Common;
using Hetu.Shared.FoundryLocal;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// Foundry Local 本地模型运行时管理面。实现是 <c>foundry</c> CLI 的一层壳，
/// 对应 CLI 的 model / server / cache 三组命令。
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

    /// <summary>运行时状态：CLI 是否安装、服务是否在跑、端点、缓存目录、本机硬件摘要</summary>
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
                Progress = 100,
                State = "completed",
            });
        }
        catch (OperationCanceledException)
        {
            await writer.WriteJsonAsync(new FoundryLocalDownloadProgressDto { Alias = id, State = "cancelled" });
        }
        catch (Exception ex)
        {
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
        try
        {
            await _service.UnloadAsync(id, cancellationToken);
            return Ok(ApiResponse.Ok());
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse.Fail(ex.Message.Split('\n')[0]));
        }
    }

    /// <summary>删除本地缓存</summary>
    [HttpDelete("models/{id}")]
    public async Task<ActionResult<ApiResponse>> Remove(string id, CancellationToken cancellationToken)
    {
        try
        {
            await _service.RemoveFromCacheAsync(id, cancellationToken);
            return Ok(ApiResponse.Ok());
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse.Fail(ex.Message.Split('\n')[0]));
        }
    }

    /// <summary>注册成 Hetu 的 Provider 模型；purpose: chat / completion / embedding</summary>
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

    /// <summary>启动本地服务</summary>
    [HttpPost("service/start")]
    public async Task<ActionResult<ApiResponse>> StartService(CancellationToken cancellationToken)
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

    /// <summary>停止本地服务</summary>
    [HttpPost("service/stop")]
    public async Task<ActionResult<ApiResponse>> StopService(CancellationToken cancellationToken)
    {
        try
        {
            await _service.StopServiceAsync(cancellationToken);
            return Ok(ApiResponse.Ok());
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse.Fail(ex.Message.Split('\n')[0]));
        }
    }

    /// <summary>重启本地服务</summary>
    [HttpPost("service/restart")]
    public async Task<ActionResult<ApiResponse>> RestartService(CancellationToken cancellationToken)
    {
        try
        {
            await _service.RestartServiceAsync(cancellationToken);
            return Ok(ApiResponse.Ok());
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse.Fail(ex.Message.Split('\n')[0]));
        }
    }

    /// <summary>设置模型缓存目录；传空恢复默认</summary>
    [HttpPut("cache-dir")]
    public async Task<ActionResult<ApiResponse<string>>> SetCacheDir(
        [FromBody] UpdateFoundryLocalCacheDirRequest request,
        CancellationToken cancellationToken)
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

        var applied = await _service.SetCacheDirAsync(string.IsNullOrWhiteSpace(path) ? null : path, cancellationToken);
        return Ok(ApiResponse<string>.Ok(applied));
    }
}
