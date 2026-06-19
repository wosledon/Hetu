using Hetu.Core.Entities;
using Hetu.Core.Exceptions;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services;

public class NotebookService : INotebookService
{
    private readonly IUnitOfWork _unitOfWork;

    public NotebookService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<NotebookDto>>> GetTreeAsync(CancellationToken cancellationToken = default)
    {
        var notebooks = await _unitOfWork.Notebooks.GetTreeAsync(cancellationToken);
        var dtos = notebooks.Select(BuildTree).ToList();
        return ApiResponse<List<NotebookDto>>.Ok(dtos);
    }

    public async Task<ApiResponse<NotebookDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var notebook = await _unitOfWork.Notebooks.GetByIdAsync(id, cancellationToken);
        if (notebook == null) return ApiResponse<NotebookDto>.Fail("笔记本不存在");
        return ApiResponse<NotebookDto>.Ok(Map(notebook));
    }

    public async Task<ApiResponse<NotebookDto>> CreateAsync(CreateNotebookRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return ApiResponse<NotebookDto>.Fail("笔记本名称不能为空");

        var notebook = new Notebook
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            ParentId = request.ParentId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Notebooks.AddAsync(notebook, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<NotebookDto>.Ok(Map(notebook));
    }

    public async Task<ApiResponse<NotebookDto>> UpdateAsync(Guid id, UpdateNotebookRequest request, CancellationToken cancellationToken = default)
    {
        var notebook = await _unitOfWork.Notebooks.GetByIdAsync(id, cancellationToken);
        if (notebook == null) return ApiResponse<NotebookDto>.Fail("笔记本不存在");

        notebook.Name = string.IsNullOrWhiteSpace(request.Name) ? notebook.Name : request.Name.Trim();
        notebook.ParentId = request.ParentId;
        notebook.SortOrder = request.SortOrder;
        notebook.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.Notebooks.UpdateAsync(notebook, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<NotebookDto>.Ok(Map(notebook));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var notebook = await _unitOfWork.Notebooks.GetByIdAsync(id, cancellationToken);
        if (notebook == null) return ApiResponse.Fail("笔记本不存在");

        if (notebook.Children.Count > 0)
            return ApiResponse.Fail("请先删除子笔记本");

        // 将该笔记本内的笔记变为未分类，再删除笔记本本身
        await _unitOfWork.Notes.UnassignNotebookAsync(id, cancellationToken);

        await _unitOfWork.Notebooks.DeleteAsync(notebook, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static NotebookDto BuildTree(Notebook notebook)
    {
        var dto = Map(notebook);
        dto.Children = notebook.Children.OrderBy(c => c.SortOrder).ThenBy(c => c.Name).Select(BuildTree).ToList();
        return dto;
    }

    private static NotebookDto Map(Notebook notebook) => new()
    {
        Id = notebook.Id,
        ParentId = notebook.ParentId,
        Name = notebook.Name,
        SortOrder = notebook.SortOrder,
        CreatedAt = notebook.CreatedAt,
        UpdatedAt = notebook.UpdatedAt
    };
}
