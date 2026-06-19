using System.Net.Http;
using System.Text;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/chat-topics")]
public class ChatTopicsController : ControllerBase
{
    private readonly IChatTopicService _chatTopicService;
    private readonly IChatOrganizeService _chatOrganizeService;

    public ChatTopicsController(IChatTopicService chatTopicService, IChatOrganizeService chatOrganizeService)
    {
        _chatTopicService = chatTopicService;
        _chatOrganizeService = chatOrganizeService;
    }

    [HttpGet("group/{groupId:guid}")]
    public Task<ApiResponse<List<ChatTopicDto>>> GetByGroup(Guid groupId, CancellationToken cancellationToken)
        => _chatTopicService.GetByGroupAsync(groupId, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<ChatTopicDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _chatTopicService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<ChatTopicDto>> Create([FromBody] CreateChatTopicRequest request, CancellationToken cancellationToken)
        => _chatTopicService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<ChatTopicDto>> Update(Guid id, [FromBody] UpdateChatTopicRequest request, CancellationToken cancellationToken)
        => _chatTopicService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _chatTopicService.DeleteAsync(id, cancellationToken);

    [HttpPost("{id:guid}/fork")]
    public Task<ApiResponse<ChatTopicDto>> Fork(Guid id, [FromQuery] Guid? branchMessageId = null, CancellationToken cancellationToken = default)
        => _chatTopicService.ForkAsync(id, branchMessageId, cancellationToken);

    [HttpPost("{id:guid}/organize")]
    public async Task Organize(Guid id, [FromBody] OrganizeTopicRequest request, CancellationToken cancellationToken)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        async Task WriteEventAsync(string data)
        {
            await Response.WriteAsync($"data: {data}\n\n", cancellationToken);
            await Response.Body.FlushAsync(cancellationToken);
        }

        try
        {
            await foreach (var delta in _chatOrganizeService.OrganizeTopicAsync(id, request, cancellationToken))
            {
                await WriteEventAsync(delta);
            }
        }
        catch (HttpRequestException ex)
        {
            await WriteEventAsync($"[ERROR] 调用模型失败：{ex.Message}");
        }
    }
}
