using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkAgentAdvanced : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CachedTokens",
                table: "WorkSessions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "CompletionTokens",
                table: "WorkSessions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "PromptTokens",
                table: "WorkSessions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "TotalTokens",
                table: "WorkSessions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "TurnCount",
                table: "WorkSessions",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "DiagnosticsCommand",
                table: "WorkProjects",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "McpServerIds",
                table: "WorkProjects",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SkillIds",
                table: "WorkProjects",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CachedTokens",
                table: "WorkMessages",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CompletionTokens",
                table: "WorkMessages",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LatencyMs",
                table: "WorkMessages",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PromptTokens",
                table: "WorkMessages",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TotalTokens",
                table: "WorkMessages",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WorkCodeChunks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    FilePath = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false),
                    StartLine = table.Column<int>(type: "INTEGER", nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    Hash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    Embedding = table.Column<byte[]>(type: "BLOB", nullable: false),
                    Model = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkCodeChunks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkCodeChunks_ProjectId",
                table: "WorkCodeChunks",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkCodeChunks_ProjectId_FilePath",
                table: "WorkCodeChunks",
                columns: new[] { "ProjectId", "FilePath" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkCodeChunks");

            migrationBuilder.DropColumn(
                name: "CachedTokens",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "CompletionTokens",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "PromptTokens",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "TotalTokens",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "TurnCount",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "DiagnosticsCommand",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "McpServerIds",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SkillIds",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "CachedTokens",
                table: "WorkMessages");

            migrationBuilder.DropColumn(
                name: "CompletionTokens",
                table: "WorkMessages");

            migrationBuilder.DropColumn(
                name: "LatencyMs",
                table: "WorkMessages");

            migrationBuilder.DropColumn(
                name: "PromptTokens",
                table: "WorkMessages");

            migrationBuilder.DropColumn(
                name: "TotalTokens",
                table: "WorkMessages");
        }
    }
}
