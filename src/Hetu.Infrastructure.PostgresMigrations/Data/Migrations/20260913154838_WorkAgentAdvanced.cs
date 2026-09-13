using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Pgvector;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
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
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "CompletionTokens",
                table: "WorkSessions",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "PromptTokens",
                table: "WorkSessions",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "TotalTokens",
                table: "WorkSessions",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "TurnCount",
                table: "WorkSessions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "DiagnosticsCommand",
                table: "WorkProjects",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "McpServerIds",
                table: "WorkProjects",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SkillIds",
                table: "WorkProjects",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CachedTokens",
                table: "WorkMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CompletionTokens",
                table: "WorkMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LatencyMs",
                table: "WorkMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PromptTokens",
                table: "WorkMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TotalTokens",
                table: "WorkMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WorkCodeChunks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    FilePath = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    StartLine = table.Column<int>(type: "integer", nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    Hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Vector = table.Column<Vector>(type: "vector", nullable: false),
                    Model = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
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
