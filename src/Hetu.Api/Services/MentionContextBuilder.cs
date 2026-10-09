using System.Text;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Notes;

namespace Hetu.Api.Services;

/// <summary>
/// 输入框 @ 引用（笔记 / 笔记本 / 标签 / 知识项）解析：把引用内容拼成一段上下文插到本轮用户消息之前。
/// 对话会话与 Code 会话共用同一份规则。
/// </summary>
public class MentionContextBuilder
{
    private readonly INoteService _noteService;
    private readonly INotebookService _notebookService;
    private readonly ITagService _tagService;
    private readonly IUnitOfWork _unitOfWork;

    public MentionContextBuilder(
        INoteService noteService,
        INotebookService notebookService,
        ITagService tagService,
        IUnitOfWork unitOfWork)
    {
        _noteService = noteService;
        _notebookService = notebookService;
        _tagService = tagService;
        _unitOfWork = unitOfWork;
    }

    /// <summary>把 @ 引用内容插入消息列表；返回已解析的引用条数，0 表示无需注入。</summary>
    public async Task<int> BuildAsync(List<ChatMentionRef>? mentions, List<LlmChatMessage> messages, CancellationToken ct)
    {
        if (mentions is not { Count: > 0 }) return 0;

        var sb = new StringBuilder("以下是用户通过 @ 引用的内容（回复时必须优先结合这些内容）：");
        var resolved = 0;

        foreach (var mention in mentions)
        {
            if (string.IsNullOrWhiteSpace(mention.Type) || !Guid.TryParse(mention.Id, out var id)) continue;

            switch (mention.Type.ToLowerInvariant())
            {
                case "note":
                {
                    var note = await _noteService.GetByIdAsync(id, ct);
                    if (note is { Success: true, Data: not null })
                    {
                        sb.AppendLine();
                        sb.AppendLine($"【笔记】{note.Data.Title}");
                        sb.AppendLine(note.Data.Content);
                        resolved++;
                    }
                    break;
                }
                case "notebook":
                {
                    var notebook = await _notebookService.GetByIdAsync(id, ct);
                    if (notebook is { Success: true, Data: not null })
                    {
                        var notes = await _noteService.GetListAsync(new GetNotesRequest { NotebookId = id, Page = 1, PageSize = 20 }, ct);
                        sb.AppendLine();
                        sb.AppendLine($"【笔记本】{notebook.Data.Name}");
                        if (notes is { Success: true, Data: not null })
                        {
                            foreach (var n in notes.Data.Items)
                                sb.AppendLine($"- {n.Title}");
                            resolved++;
                        }
                    }
                    break;
                }
                case "tag":
                {
                    var tag = await _tagService.GetByIdAsync(id, ct);
                    if (tag is { Success: true, Data: not null })
                    {
                        var notes = await _noteService.GetListAsync(new GetNotesRequest { TagId = id, Page = 1, PageSize = 20 }, ct);
                        sb.AppendLine();
                        sb.AppendLine($"【标签】{tag.Data.Name}");
                        if (notes is { Success: true, Data: not null })
                        {
                            foreach (var n in notes.Data.Items)
                                sb.AppendLine($"- {n.Title}");
                            resolved++;
                        }
                    }
                    break;
                }
                case "knowledge":
                {
                    var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(id, ct);
                    if (item != null)
                    {
                        sb.AppendLine();
                        sb.AppendLine($"【知识库】{item.Title}");
                        sb.AppendLine(item.Content);
                        resolved++;
                    }
                    break;
                }
            }
        }

        if (resolved == 0) return 0;

        messages.Insert(Math.Max(0, messages.Count - 1),
            new LlmChatMessage { Role = "user", Content = sb.ToString().TrimEnd() });
        return resolved;
    }
}
