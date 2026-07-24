using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface IUnitOfWork : IAsyncDisposable
{
    INotebookRepository Notebooks { get; }
    INoteRepository Notes { get; }
    IKnowledgeItemRepository KnowledgeItems { get; }
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
    IRepository<Workflow> Workflows { get; }
    IRepository<WorkflowRun> WorkflowRuns { get; }
    IRepository<WorkflowRunNode> WorkflowRunNodes { get; }
    IRepository<GraphEntity> GraphEntities { get; }
    IRepository<GraphRelation> GraphRelations { get; }
    IRepository<ShareLink> ShareLinks { get; }
    IRepository<TaskItem> TaskItems { get; }
    IRepository<ScheduledTask> ScheduledTasks { get; }
    IRepository<ScheduledTaskExecution> ScheduledTaskExecutions { get; }
    IRepository<Memory> Memories { get; }
    IRepository<MemoryEmbedding> MemoryEmbeddings { get; }
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
