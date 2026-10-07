using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class KanbanTaskAutomation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AgentId",
                table: "KanbanTasks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LastRunId",
                table: "KanbanTasks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ProjectId",
                table: "KanbanTasks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "WorkflowId",
                table: "KanbanTasks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Link",
                table: "InboxNotifications",
                type: "TEXT",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "KanbanTaskComments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    TaskId = table.Column<Guid>(type: "TEXT", nullable: false),
                    AuthorType = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    AuthorName = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    RunId = table.Column<Guid>(type: "TEXT", nullable: true),
                    IsDeleted = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KanbanTaskComments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "KanbanTaskRuns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    TaskId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Trigger = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Input = table.Column<string>(type: "TEXT", nullable: true),
                    Output = table.Column<string>(type: "TEXT", nullable: true),
                    Error = table.Column<string>(type: "TEXT", maxLength: 4000, nullable: true),
                    WorkflowRunId = table.Column<Guid>(type: "TEXT", nullable: true),
                    StartedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CompletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KanbanTaskRuns", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTasks_AgentId",
                table: "KanbanTasks",
                column: "AgentId");

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTasks_ProjectId",
                table: "KanbanTasks",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTasks_WorkflowId",
                table: "KanbanTasks",
                column: "WorkflowId");

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTaskComments_CreatedAt",
                table: "KanbanTaskComments",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTaskComments_TaskId",
                table: "KanbanTaskComments",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTaskRuns_CreatedAt",
                table: "KanbanTaskRuns",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTaskRuns_TaskId",
                table: "KanbanTaskRuns",
                column: "TaskId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "KanbanTaskComments");

            migrationBuilder.DropTable(
                name: "KanbanTaskRuns");

            migrationBuilder.DropIndex(
                name: "IX_KanbanTasks_AgentId",
                table: "KanbanTasks");

            migrationBuilder.DropIndex(
                name: "IX_KanbanTasks_ProjectId",
                table: "KanbanTasks");

            migrationBuilder.DropIndex(
                name: "IX_KanbanTasks_WorkflowId",
                table: "KanbanTasks");

            migrationBuilder.DropColumn(
                name: "AgentId",
                table: "KanbanTasks");

            migrationBuilder.DropColumn(
                name: "LastRunId",
                table: "KanbanTasks");

            migrationBuilder.DropColumn(
                name: "ProjectId",
                table: "KanbanTasks");

            migrationBuilder.DropColumn(
                name: "WorkflowId",
                table: "KanbanTasks");

            migrationBuilder.DropColumn(
                name: "Link",
                table: "InboxNotifications");
        }
    }
}
