using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TagsController : ControllerBase
{
    private readonly ITagService _tagService;

    public TagsController(ITagService tagService)
    {
        _tagService = tagService;
    }

    [HttpGet]
    public Task<ApiResponse<List<TagDto>>> GetAll(CancellationToken cancellationToken)
        => _tagService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<TagDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _tagService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<TagDto>> Create([FromBody] CreateTagRequest request, CancellationToken cancellationToken)
        => _tagService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<TagDto>> Update(Guid id, [FromBody] UpdateTagRequest request, CancellationToken cancellationToken)
        => _tagService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _tagService.DeleteAsync(id, cancellationToken);

    [HttpPost("merge")]
    public Task<ApiResponse> Merge([FromBody] MergeTagsRequest request, CancellationToken cancellationToken)
        => _tagService.MergeAsync(request, cancellationToken);

    [HttpGet("note/{noteId:guid}")]
    public Task<ApiResponse<List<TagDto>>> GetByNote(Guid noteId, CancellationToken cancellationToken)
        => _tagService.GetByNoteAsync(noteId, cancellationToken);

    [HttpPut("note/{noteId:guid}")]
    public Task<ApiResponse> SetNoteTags(Guid noteId, [FromBody] ManageNoteTagsRequest request, CancellationToken cancellationToken)
        => _tagService.SetNoteTagsAsync(noteId, request, cancellationToken);
}
