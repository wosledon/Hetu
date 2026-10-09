using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddContextSummaryAndAgentMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AgentMode",
                table: "WorkSessions",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ContextSummary",
                table: "WorkSessions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ContextSummaryThroughMessageId",
                table: "WorkSessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContextSummary",
                table: "ChatTopics",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ContextSummaryThroughMessageId",
                table: "ChatTopics",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AgentMode",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "ContextSummary",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "ContextSummaryThroughMessageId",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "ContextSummary",
                table: "ChatTopics");

            migrationBuilder.DropColumn(
                name: "ContextSummaryThroughMessageId",
                table: "ChatTopics");
        }
    }
}
