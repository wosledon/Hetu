using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;

namespace Hetu.Infrastructure.Repositories;

public class UnitOfWork : IUnitOfWork
{
    private readonly HetuDbContext _context;

    public INotebookRepository Notebooks { get; }
    public INoteRepository Notes { get; }
    public ITagRepository Tags { get; }
    public IAppSettingRepository AppSettings { get; }
    public IAiProviderRepository AiProviders { get; }
    public IAiModelRepository AiModels { get; }
    public IRepository<ChatGroup> ChatGroups { get; }
    public IRepository<ChatTopic> ChatTopics { get; }
    public IRepository<ChatMessage> ChatMessages { get; }
    public IRepository<PromptPreset> PromptPresets { get; }
    public IRepository<NoteVersion> NoteVersions { get; }
    public IRepository<Skill> Skills { get; }
    public IRepository<McpServer> McpServers { get; }
    public IRepository<GraphEntity> GraphEntities { get; }
    public IRepository<GraphRelation> GraphRelations { get; }
    public IRepository<ShareLink> ShareLinks { get; }

    public UnitOfWork(HetuDbContext context)
    {
        _context = context;
        Notebooks = new NotebookRepository(context);
        Notes = new NoteRepository(context);
        Tags = new TagRepository(context);
        AppSettings = new AppSettingRepository(context);
        AiProviders = new AiProviderRepository(context);
        AiModels = new AiModelRepository(context);
        ChatGroups = new EfRepository<ChatGroup>(context);
        ChatTopics = new EfRepository<ChatTopic>(context);
        ChatMessages = new EfRepository<ChatMessage>(context);
        PromptPresets = new EfRepository<PromptPreset>(context);
        NoteVersions = new EfRepository<NoteVersion>(context);
        Skills = new EfRepository<Skill>(context);
        McpServers = new EfRepository<McpServer>(context);
        GraphEntities = new EfRepository<GraphEntity>(context);
        GraphRelations = new EfRepository<GraphRelation>(context);
        ShareLinks = new EfRepository<ShareLink>(context);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        => _context.SaveChangesAsync(cancellationToken);

    public ValueTask DisposeAsync()
        => _context.DisposeAsync();
}
