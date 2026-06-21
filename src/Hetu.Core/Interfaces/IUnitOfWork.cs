using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface IUnitOfWork : IAsyncDisposable
{
    INotebookRepository Notebooks { get; }
    INoteRepository Notes { get; }
    ITagRepository Tags { get; }
    IAppSettingRepository AppSettings { get; }
    IAiProviderRepository AiProviders { get; }
    IAiModelRepository AiModels { get; }
    IRepository<ChatGroup> ChatGroups { get; }
    IRepository<ChatTopic> ChatTopics { get; }
    IRepository<ChatMessage> ChatMessages { get; }
    IRepository<PromptPreset> PromptPresets { get; }
    IRepository<NoteVersion> NoteVersions { get; }
    IRepository<Skill> Skills { get; }
    IRepository<McpServer> McpServers { get; }
    IRepository<GraphEntity> GraphEntities { get; }
    IRepository<GraphRelation> GraphRelations { get; }
    IRepository<ShareLink> ShareLinks { get; }
    IRepository<TaskItem> TaskItems { get; }
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
