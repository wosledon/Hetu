using Hetu.Core.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Hetu.Infrastructure.Data;

public class HetuDbContext : DbContext
{
    public HetuDbContext(DbContextOptions<HetuDbContext> options) : base(options) { }

    public DbSet<Notebook> Notebooks => Set<Notebook>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<NoteTag> NoteTags => Set<NoteTag>();
    public DbSet<NoteVersion> NoteVersions => Set<NoteVersion>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<AiProvider> AiProviders => Set<AiProvider>();
    public DbSet<AiModel> AiModels => Set<AiModel>();
    public DbSet<NoteEmbedding> NoteEmbeddings => Set<NoteEmbedding>();
    public DbSet<ChatGroup> ChatGroups => Set<ChatGroup>();
    public DbSet<ChatTopic> ChatTopics => Set<ChatTopic>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<PromptPreset> PromptPresets => Set<PromptPreset>();
    public DbSet<Skill> Skills => Set<Skill>();
    public DbSet<McpServer> McpServers => Set<McpServer>();
    public DbSet<GraphEntity> GraphEntities => Set<GraphEntity>();
    public DbSet<GraphRelation> GraphRelations => Set<GraphRelation>();
    public DbSet<ShareLink> ShareLinks => Set<ShareLink>();
    public DbSet<TaskItem> TaskItems => Set<TaskItem>();
    public DbSet<NoteChunk> NoteChunks => Set<NoteChunk>();
    public DbSet<NoteChunkEmbedding> NoteChunkEmbeddings => Set<NoteChunkEmbedding>();
    public DbSet<KnowledgeItem> KnowledgeItems => Set<KnowledgeItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Notebook>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.HasOne(e => e.Parent)
                .WithMany(e => e.Children)
                .HasForeignKey(e => e.ParentId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => e.ParentId);
        });

        modelBuilder.Entity<Note>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).IsRequired().HasMaxLength(500);
            entity.Property(e => e.Content).HasDefaultValue(string.Empty);
            entity.HasOne(e => e.Notebook)
                .WithMany(e => e.Notes)
                .HasForeignKey(e => e.NotebookId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasIndex(e => e.NotebookId);
            entity.HasIndex(e => e.IsDeleted);
            entity.HasIndex(e => e.UpdatedAt);
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        modelBuilder.Entity<Tag>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(100);
            entity.HasIndex(e => e.Name).IsUnique();
        });

        modelBuilder.Entity<NoteTag>(entity =>
        {
            entity.HasKey(e => new { e.NoteId, e.TagId });
            entity.HasOne(e => e.Note)
                .WithMany(e => e.NoteTags)
                .HasForeignKey(e => e.NoteId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tag)
                .WithMany(e => e.NoteTags)
                .HasForeignKey(e => e.TagId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<NoteVersion>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).IsRequired().HasMaxLength(500);
            entity.HasOne(e => e.Note)
                .WithMany()
                .HasForeignKey(e => e.NoteId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.NoteId);
        });

        modelBuilder.Entity<AppSetting>(entity =>
        {
            entity.HasKey(e => e.Key);
            entity.Property(e => e.Key).HasMaxLength(100);
            entity.Property(e => e.Value).HasMaxLength(4000);
        });

        modelBuilder.Entity<AiProvider>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProviderType).IsRequired().HasMaxLength(50);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.Property(e => e.EncryptedApiKey).IsRequired();
            entity.Property(e => e.BaseUrl).HasMaxLength(500);
            entity.HasMany(e => e.Models)
                .WithOne(e => e.Provider)
                .HasForeignKey(e => e.ProviderId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AiModel>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ModelId).IsRequired().HasMaxLength(200);
            entity.Property(e => e.DisplayName).IsRequired().HasMaxLength(200);
            entity.Property(e => e.Purpose).IsRequired().HasMaxLength(50);
            entity.HasIndex(e => e.ProviderId);
            entity.HasIndex(e => new { e.Purpose, e.IsDefault });
        });

        modelBuilder.Entity<NoteEmbedding>(entity =>
        {
            entity.HasKey(e => e.NoteId);
            entity.HasOne(e => e.Note)
                .WithOne()
                .HasForeignKey<NoteEmbedding>(e => e.NoteId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.Property(e => e.Model).IsRequired().HasMaxLength(200);

            if (Database.IsNpgsql())
            {
                modelBuilder.HasPostgresExtension("vector");
                entity.Ignore(e => e.Embedding);

                var vectorComparer = new ValueComparer<float[]>(
                    (a, b) => (a == null && b == null) || (a != null && b != null && a.SequenceEqual(b)),
                    v => v == null ? 0 : v.Aggregate(0, (hash, f) => HashCode.Combine(hash, f.GetHashCode())),
                    v => v.ToArray());

                entity.Property(e => e.Vector)
                    .IsRequired()
                    .HasColumnType("vector")
                    .HasConversion(new VectorFloatArrayConverter(), vectorComparer);

                entity.HasIndex(e => e.Vector)
                    .HasMethod("hnsw")
                    .HasOperators("vector_cosine_ops");
            }
            else
            {
                entity.Ignore(e => e.Vector);
                entity.Property(e => e.Embedding).IsRequired();
            }
        });

        modelBuilder.Entity<ChatGroup>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.Property(e => e.Color).HasMaxLength(50);
            entity.Property(e => e.Icon).HasMaxLength(50);
        });

        modelBuilder.Entity<ChatTopic>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).IsRequired().HasMaxLength(200);
            entity.HasOne(e => e.Group)
                .WithMany(e => e.Topics)
                .HasForeignKey(e => e.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.GroupId);
        });

        modelBuilder.Entity<ChatMessage>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Role).IsRequired().HasMaxLength(50);
            entity.Property(e => e.Content).IsRequired();
            entity.HasOne(e => e.Topic)
                .WithMany(e => e.Messages)
                .HasForeignKey(e => e.TopicId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.TopicId);
        });

        modelBuilder.Entity<PromptPreset>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Category).IsRequired().HasMaxLength(100);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.Property(e => e.Content).IsRequired();
        });

        modelBuilder.Entity<Skill>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.Property(e => e.Description).IsRequired().HasMaxLength(500);
            entity.Property(e => e.Category).IsRequired().HasMaxLength(100);
        });

        modelBuilder.Entity<McpServer>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.Property(e => e.Description).IsRequired().HasMaxLength(500);
            entity.Property(e => e.Type).IsRequired().HasMaxLength(50);
        });

        modelBuilder.Entity<GraphEntity>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(200);
            entity.Property(e => e.Type).IsRequired().HasMaxLength(50);
            entity.Property(e => e.Description).HasMaxLength(1000);
            entity.HasIndex(e => e.Name);
        });

        modelBuilder.Entity<GraphRelation>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RelationType).IsRequired().HasMaxLength(50);
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.HasOne(e => e.SourceEntity)
                .WithMany(e => e.OutgoingRelations)
                .HasForeignKey(e => e.SourceEntityId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.TargetEntity)
                .WithMany(e => e.IncomingRelations)
                .HasForeignKey(e => e.TargetEntityId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.SourceEntityId);
            entity.HasIndex(e => e.TargetEntityId);
        });

        modelBuilder.Entity<ShareLink>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ShareCode).IsRequired().HasMaxLength(20);
            entity.HasIndex(e => e.ShareCode).IsUnique();
            entity.HasOne(e => e.Note)
                .WithMany()
                .HasForeignKey(e => e.NoteId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TaskItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TaskType).IsRequired().HasMaxLength(100);
            entity.Property(e => e.EntityTitle).HasMaxLength(500);
            entity.HasIndex(e => e.TaskType);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.IsDeleted);
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        modelBuilder.Entity<KnowledgeItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).IsRequired().HasMaxLength(500);
            entity.Property(e => e.Content).HasDefaultValue(string.Empty);
            entity.Property(e => e.Type).HasConversion<string>().HasMaxLength(20);
            entity.Property(e => e.SourceUrl).HasMaxLength(2000);
            entity.Property(e => e.FilePath).HasMaxLength(2000);
            entity.Property(e => e.FileName).HasMaxLength(500);
            entity.Property(e => e.MimeType).HasMaxLength(200);
            entity.HasOne(e => e.Note)
                .WithMany(n => n.KnowledgeItems)
                .HasForeignKey(e => e.NoteId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasIndex(e => e.Type);
            entity.HasIndex(e => e.NoteId);
            entity.HasIndex(e => e.IsDeleted);
            entity.HasIndex(e => e.UpdatedAt);
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        modelBuilder.Entity<NoteChunk>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Content).IsRequired();
            entity.Property(e => e.Summary).HasMaxLength(2000);
            entity.Property(e => e.ChunkMethod).IsRequired().HasMaxLength(50);
            entity.HasOne(e => e.KnowledgeItem)
                .WithMany(k => k.Chunks)
                .HasForeignKey(e => e.KnowledgeItemId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.KnowledgeItemId);
            entity.HasIndex(e => new { e.KnowledgeItemId, e.ChunkIndex }).IsUnique();
        });

        modelBuilder.Entity<NoteChunkEmbedding>(entity =>
        {
            entity.HasKey(e => e.ChunkId);
            entity.HasOne(e => e.Chunk)
                .WithOne()
                .HasForeignKey<NoteChunkEmbedding>(e => e.ChunkId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.Property(e => e.Model).IsRequired().HasMaxLength(200);

            if (Database.IsNpgsql())
            {
                entity.Ignore(e => e.Embedding);

                var vectorComparer = new ValueComparer<float[]>(
                    (a, b) => (a == null && b == null) || (a != null && b != null && a.SequenceEqual(b)),
                    v => v == null ? 0 : v.Aggregate(0, (hash, f) => HashCode.Combine(hash, f.GetHashCode())),
                    v => v.ToArray());

                entity.Property(e => e.Vector)
                    .IsRequired()
                    .HasColumnType("vector")
                    .HasConversion(new VectorFloatArrayConverter(), vectorComparer);

                entity.HasIndex(e => e.Vector)
                    .HasMethod("hnsw")
                    .HasOperators("vector_cosine_ops");
            }
            else
            {
                entity.Ignore(e => e.Vector);
                entity.Property(e => e.Embedding).IsRequired();
            }
        });
    }
}
