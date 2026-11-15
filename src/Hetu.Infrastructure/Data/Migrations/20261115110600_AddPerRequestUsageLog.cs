using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPerRequestUsageLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CacheCreationTokens",
                table: "LlmUsageLogs",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FinishReason",
                table: "LlmUsageLogs",
                type: "TEXT",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Iteration",
                table: "LlmUsageLogs",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PromptTokens",
                table: "LlmUsageLogs",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RequestKind",
                table: "LlmUsageLogs",
                type: "TEXT",
                maxLength: 30,
                nullable: false,
                defaultValue: "agent");

            migrationBuilder.AddColumn<int>(
                name: "ToolCallCount",
                table: "LlmUsageLogs",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TurnId",
                table: "LlmUsageLogs",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_LlmUsageLogs_CreatedAt",
                table: "LlmUsageLogs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_LlmUsageLogs_RefId",
                table: "LlmUsageLogs",
                column: "RefId");

            migrationBuilder.CreateIndex(
                name: "IX_LlmUsageLogs_Source",
                table: "LlmUsageLogs",
                column: "Source");

            migrationBuilder.CreateIndex(
                name: "IX_LlmUsageLogs_TurnId",
                table: "LlmUsageLogs",
                column: "TurnId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_LlmUsageLogs_CreatedAt",
                table: "LlmUsageLogs");

            migrationBuilder.DropIndex(
                name: "IX_LlmUsageLogs_RefId",
                table: "LlmUsageLogs");

            migrationBuilder.DropIndex(
                name: "IX_LlmUsageLogs_Source",
                table: "LlmUsageLogs");

            migrationBuilder.DropIndex(
                name: "IX_LlmUsageLogs_TurnId",
                table: "LlmUsageLogs");

            migrationBuilder.DropColumn(
                name: "CacheCreationTokens",
                table: "LlmUsageLogs");

            migrationBuilder.DropColumn(
                name: "FinishReason",
                table: "LlmUsageLogs");

            migrationBuilder.DropColumn(
                name: "Iteration",
                table: "LlmUsageLogs");

            migrationBuilder.DropColumn(
                name: "PromptTokens",
                table: "LlmUsageLogs");

            migrationBuilder.DropColumn(
                name: "RequestKind",
                table: "LlmUsageLogs");

            migrationBuilder.DropColumn(
                name: "ToolCallCount",
                table: "LlmUsageLogs");

            migrationBuilder.DropColumn(
                name: "TurnId",
                table: "LlmUsageLogs");
        }
    }
}
