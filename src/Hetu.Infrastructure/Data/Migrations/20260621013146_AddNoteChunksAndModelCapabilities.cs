using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteChunksAndModelCapabilities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsVisible",
                table: "AiModels",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "SupportsReasoning",
                table: "AiModels",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "SupportsTools",
                table: "AiModels",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "SupportsVision",
                table: "AiModels",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "NoteChunks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    NoteId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ChunkIndex = table.Column<int>(type: "INTEGER", nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    Summary = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    ChunkMethod = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteChunks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NoteChunks_Notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "Notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NoteChunkEmbeddings",
                columns: table => new
                {
                    ChunkId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Embedding = table.Column<byte[]>(type: "BLOB", nullable: false),
                    Model = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Dimensions = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
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
                name: "IX_NoteChunks_NoteId",
                table: "NoteChunks",
                column: "NoteId");

            migrationBuilder.CreateIndex(
                name: "IX_NoteChunks_NoteId_ChunkIndex",
                table: "NoteChunks",
                columns: new[] { "NoteId", "ChunkIndex" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoteChunkEmbeddings");

            migrationBuilder.DropTable(
                name: "NoteChunks");

            migrationBuilder.DropColumn(
                name: "IsVisible",
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
        }
    }
}
