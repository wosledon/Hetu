using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Pgvector;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAgent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ContextWindowSize",
                table: "ChatTopics");

            migrationBuilder.DropColumn(
                name: "IsArchived",
                table: "ChatTopics");

            migrationBuilder.AddColumn<string>(
                name: "ToolsConfig",
                table: "PromptPresets",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BranchMessageId",
                table: "ChatTopics",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NoteSyncStatus",
                table: "ChatTopics",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "ParentTopicId",
                table: "ChatTopics",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "KnowledgeResultsJson",
                table: "ChatMessages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MemoryResultsJson",
                table: "ChatMessages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SearchResultsJson",
                table: "ChatMessages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ThinkingContent",
                table: "ChatMessages",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Dimensions",
                table: "AiModels",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsVisible",
                table: "AiModels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ReasoningEffort",
                table: "AiModels",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ReasoningMode",
                table: "AiModels",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "SupportsReasoning",
                table: "AiModels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "SupportsTools",
                table: "AiModels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "SupportsVision",
                table: "AiModels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "Agents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SystemPrompt = table.Column<string>(type: "text", nullable: false),
                    ModelId = table.Column<Guid>(type: "uuid", nullable: true),
                    ToolNames = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    McpServerIds = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    SkillIds = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ToolApprovals = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    MaxToolCallsPerTurn = table.Column<int>(type: "integer", nullable: false),
                    MaxAgentIterations = table.Column<int>(type: "integer", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Agents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GraphEntities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Metadata = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GraphEntities", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "KnowledgeItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false, defaultValue: ""),
                    FilePath = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    FileName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    FileSize = table.Column<long>(type: "bigint", nullable: true),
                    MimeType = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SourceUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    NoteId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KnowledgeItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_KnowledgeItems_Notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "Notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Memories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    Source = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TopicId = table.Column<Guid>(type: "uuid", nullable: true),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Importance = table.Column<float>(type: "real", nullable: false),
                    LastAccessedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AccessCount = table.Column<int>(type: "integer", nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Memories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ScheduledTaskExecutions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ScheduledTaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ErrorMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Result = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    RetryAttempt = table.Column<int>(type: "integer", nullable: false),
                    IsManual = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledTaskExecutions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ScheduledTasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    TaskKind = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TargetId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TargetName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Parameters = table.Column<string>(type: "text", nullable: true),
                    ScheduleType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    IntervalMinutes = table.Column<int>(type: "integer", nullable: false),
                    CronExpression = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    NextRunAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastRunAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    LastError = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    MaxRetries = table.Column<int>(type: "integer", nullable: false),
                    RetryCount = table.Column<int>(type: "integer", nullable: false),
                    TopicId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledTasks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ShareLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    ShareCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ViewCount = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShareLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShareLinks_Notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "Notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TaskItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityTitle = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ErrorMessage = table.Column<string>(type: "text", nullable: true),
                    Metadata = table.Column<string>(type: "text", nullable: true),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskItems", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GraphRelations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceEntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetEntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    RelationType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Confidence = table.Column<double>(type: "double precision", nullable: false),
                    SourceNoteId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GraphRelations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GraphRelations_GraphEntities_SourceEntityId",
                        column: x => x.SourceEntityId,
                        principalTable: "GraphEntities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GraphRelations_GraphEntities_TargetEntityId",
                        column: x => x.TargetEntityId,
                        principalTable: "GraphEntities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NoteChunks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    KnowledgeItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChunkIndex = table.Column<int>(type: "integer", nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    Summary = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ChunkMethod = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteChunks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NoteChunks_KnowledgeItems_KnowledgeItemId",
                        column: x => x.KnowledgeItemId,
                        principalTable: "KnowledgeItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MemoryEmbeddings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MemoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    Vector = table.Column<Vector>(type: "vector", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MemoryEmbeddings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MemoryEmbeddings_Memories_MemoryId",
                        column: x => x.MemoryId,
                        principalTable: "Memories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NoteChunkEmbeddings",
                columns: table => new
                {
                    ChunkId = table.Column<Guid>(type: "uuid", nullable: false),
                    Vector = table.Column<Vector>(type: "vector", nullable: false),
                    Model = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Dimensions = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteChunkEmbeddings", x => x.ChunkId);
                    table.ForeignKey(
                        name: "FK_NoteChunkEmbeddings_NoteChunks_ChunkId",
                        column: x => x.ChunkId,
                        principalTable: "NoteChunks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NoteEmbeddings_Vector",
                table: "NoteEmbeddings",
                column: "Vector")
                .Annotation("Npgsql:IndexMethod", "hnsw")
                .Annotation("Npgsql:IndexOperators", new[] { "vector_cosine_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_Agents_Category",
                table: "Agents",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_GraphEntities_Name",
                table: "GraphEntities",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_GraphRelations_IsDeleted",
                table: "GraphRelations",
                column: "IsDeleted");

            migrationBuilder.CreateIndex(
                name: "IX_GraphRelations_SourceEntityId",
                table: "GraphRelations",
                column: "SourceEntityId");

            migrationBuilder.CreateIndex(
                name: "IX_GraphRelations_TargetEntityId",
                table: "GraphRelations",
                column: "TargetEntityId");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeItems_IsDeleted",
                table: "KnowledgeItems",
                column: "IsDeleted");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeItems_NoteId",
                table: "KnowledgeItems",
                column: "NoteId");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeItems_Type",
                table: "KnowledgeItems",
                column: "Type");

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeItems_UpdatedAt",
                table: "KnowledgeItems",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_Category",
                table: "Memories",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_Importance",
                table: "Memories",
                column: "Importance");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_IsDeleted",
                table: "Memories",
                column: "IsDeleted");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_LastAccessedAt",
                table: "Memories",
                column: "LastAccessedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_Source",
                table: "Memories",
                column: "Source");

            migrationBuilder.CreateIndex(
                name: "IX_MemoryEmbeddings_MemoryId",
                table: "MemoryEmbeddings",
                column: "MemoryId");

            migrationBuilder.CreateIndex(
                name: "IX_MemoryEmbeddings_Vector",
                table: "MemoryEmbeddings",
                column: "Vector")
                .Annotation("Npgsql:IndexMethod", "hnsw")
                .Annotation("Npgsql:IndexOperators", new[] { "vector_cosine_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_NoteChunkEmbeddings_Vector",
                table: "NoteChunkEmbeddings",
                column: "Vector")
                .Annotation("Npgsql:IndexMethod", "hnsw")
                .Annotation("Npgsql:IndexOperators", new[] { "vector_cosine_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_NoteChunks_KnowledgeItemId",
                table: "NoteChunks",
                column: "KnowledgeItemId");

            migrationBuilder.CreateIndex(
                name: "IX_NoteChunks_KnowledgeItemId_ChunkIndex",
                table: "NoteChunks",
                columns: new[] { "KnowledgeItemId", "ChunkIndex" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTaskExecutions_ScheduledTaskId",
                table: "ScheduledTaskExecutions",
                column: "ScheduledTaskId");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTaskExecutions_StartedAt",
                table: "ScheduledTaskExecutions",
                column: "StartedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTasks_IsDeleted",
                table: "ScheduledTasks",
                column: "IsDeleted");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTasks_IsEnabled",
                table: "ScheduledTasks",
                column: "IsEnabled");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTasks_NextRunAt",
                table: "ScheduledTasks",
                column: "NextRunAt");

            migrationBuilder.CreateIndex(
                name: "IX_ShareLinks_NoteId",
                table: "ShareLinks",
                column: "NoteId");

            migrationBuilder.CreateIndex(
                name: "IX_ShareLinks_ShareCode",
                table: "ShareLinks",
                column: "ShareCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TaskItems_IsDeleted",
                table: "TaskItems",
                column: "IsDeleted");

            migrationBuilder.CreateIndex(
                name: "IX_TaskItems_Status",
                table: "TaskItems",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_TaskItems_TaskType",
                table: "TaskItems",
                column: "TaskType");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Agents");

            migrationBuilder.DropTable(
                name: "GraphRelations");

            migrationBuilder.DropTable(
                name: "MemoryEmbeddings");

            migrationBuilder.DropTable(
                name: "NoteChunkEmbeddings");

            migrationBuilder.DropTable(
                name: "ScheduledTaskExecutions");

            migrationBuilder.DropTable(
                name: "ScheduledTasks");

            migrationBuilder.DropTable(
                name: "ShareLinks");

            migrationBuilder.DropTable(
                name: "TaskItems");

            migrationBuilder.DropTable(
                name: "GraphEntities");

            migrationBuilder.DropTable(
                name: "Memories");

            migrationBuilder.DropTable(
                name: "NoteChunks");

            migrationBuilder.DropTable(
                name: "KnowledgeItems");

            migrationBuilder.DropIndex(
                name: "IX_NoteEmbeddings_Vector",
                table: "NoteEmbeddings");

            migrationBuilder.DropColumn(
                name: "ToolsConfig",
                table: "PromptPresets");

            migrationBuilder.DropColumn(
                name: "BranchMessageId",
                table: "ChatTopics");

            migrationBuilder.DropColumn(
                name: "NoteSyncStatus",
                table: "ChatTopics");

            migrationBuilder.DropColumn(
                name: "ParentTopicId",
                table: "ChatTopics");

            migrationBuilder.DropColumn(
                name: "KnowledgeResultsJson",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "MemoryResultsJson",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "SearchResultsJson",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "ThinkingContent",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "Dimensions",
                table: "AiModels");

            migrationBuilder.DropColumn(
                name: "IsVisible",
                table: "AiModels");

            migrationBuilder.DropColumn(
                name: "ReasoningEffort",
                table: "AiModels");

            migrationBuilder.DropColumn(
                name: "ReasoningMode",
                table: "AiModels");

            migrationBuilder.DropColumn(
                name: "SupportsReasoning",
                table: "AiModels");

            migrationBuilder.DropColumn(
                name: "SupportsTools",
                table: "AiModels");

            migrationBuilder.DropColumn(
                name: "SupportsVision",
                table: "AiModels");

            migrationBuilder.AddColumn<int>(
                name: "ContextWindowSize",
                table: "ChatTopics",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsArchived",
                table: "ChatTopics",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
