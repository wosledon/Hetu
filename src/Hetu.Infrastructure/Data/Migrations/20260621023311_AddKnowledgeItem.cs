using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddKnowledgeItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NoteChunks_Notes_NoteId",
                table: "NoteChunks");

            migrationBuilder.RenameColumn(
                name: "NoteId",
                table: "NoteChunks",
                newName: "KnowledgeItemId");

            migrationBuilder.RenameIndex(
                name: "IX_NoteChunks_NoteId_ChunkIndex",
                table: "NoteChunks",
                newName: "IX_NoteChunks_KnowledgeItemId_ChunkIndex");

            migrationBuilder.RenameIndex(
                name: "IX_NoteChunks_NoteId",
                table: "NoteChunks",
                newName: "IX_NoteChunks_KnowledgeItemId");

            migrationBuilder.CreateTable(
                name: "KnowledgeItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Type = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    FilePath = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    FileName = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    FileSize = table.Column<long>(type: "INTEGER", nullable: true),
                    MimeType = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    SourceUrl = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    NoteId = table.Column<Guid>(type: "TEXT", nullable: true),
                    IsDeleted = table.Column<bool>(type: "INTEGER", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
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

            migrationBuilder.AddForeignKey(
                name: "FK_NoteChunks_KnowledgeItems_KnowledgeItemId",
                table: "NoteChunks",
                column: "KnowledgeItemId",
                principalTable: "KnowledgeItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            // ── 数据迁移：为已有笔记创建 KnowledgeItem，Id 与 NoteId 相同 ──
            migrationBuilder.Sql(@"
                INSERT INTO KnowledgeItems (Id, Type, Title, Content, NoteId, IsDeleted, DeletedAt, CreatedAt, UpdatedAt)
                SELECT Id, 'Note', Title, Content, Id, IsDeleted, DeletedAt, CreatedAt, UpdatedAt
                FROM Notes
            ");

            // 为回收站中的笔记也创建 KnowledgeItem（使用 IgnoreQueryFilters 的 SQL 已包含）
            // NoteChunks.KnowledgeItemId 现在存的是旧 NoteId，而 KnowledgeItem.Id = NoteId，外键自动匹配
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NoteChunks_KnowledgeItems_KnowledgeItemId",
                table: "NoteChunks");

            migrationBuilder.DropTable(
                name: "KnowledgeItems");

            migrationBuilder.RenameColumn(
                name: "KnowledgeItemId",
                table: "NoteChunks",
                newName: "NoteId");

            migrationBuilder.RenameIndex(
                name: "IX_NoteChunks_KnowledgeItemId_ChunkIndex",
                table: "NoteChunks",
                newName: "IX_NoteChunks_NoteId_ChunkIndex");

            migrationBuilder.RenameIndex(
                name: "IX_NoteChunks_KnowledgeItemId",
                table: "NoteChunks",
                newName: "IX_NoteChunks_NoteId");

            migrationBuilder.AddForeignKey(
                name: "FK_NoteChunks_Notes_NoteId",
                table: "NoteChunks",
                column: "NoteId",
                principalTable: "Notes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
