using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/chat-groups")]
public class ChatGroupsController : ControllerBase
{
    private readonly IChatGroupService _chatGroupService;

    public ChatGroupsController(IChatGroupService chatGroupService)
    {
        _chatGroupService = chatGroupService;
    }

    [HttpGet]
    public Task<ApiResponse<List<ChatGroupDto>>> GetAll(CancellationToken cancellationToken)
        => _chatGroupService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<ChatGroupDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _chatGroupService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<ChatGroupDto>> Create([FromBody] CreateChatGroupRequest request, CancellationToken cancellationToken)
        => _chatGroupService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<ChatGroupDto>> Update(Guid id, [FromBody] UpdateChatGroupRequest request, CancellationToken cancellationToken)
        => _chatGroupService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _chatGroupService.DeleteAsync(id, cancellationToken);
}
