using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkAgentCapabilities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PermissionMode",
                table: "WorkSessions",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "ask");

            migrationBuilder.CreateTable(
                name: "WorkApprovalRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    ToolName = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    PathPattern = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    Decision = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    IsEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkApprovalRules", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WorkCheckpoints",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SessionId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Label = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Tools = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    FileCount = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkCheckpoints", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WorkCheckpointFiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    CheckpointId = table.Column<Guid>(type: "TEXT", nullable: false),
                    FilePath = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkCheckpointFiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkCheckpointFiles_WorkCheckpoints_CheckpointId",
                        column: x => x.CheckpointId,
                        principalTable: "WorkCheckpoints",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkApprovalRules_ProjectId",
                table: "WorkApprovalRules",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkCheckpointFiles_CheckpointId",
                table: "WorkCheckpointFiles",
                column: "CheckpointId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkCheckpoints_CreatedAt",
                table: "WorkCheckpoints",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_WorkCheckpoints_SessionId",
                table: "WorkCheckpoints",
                column: "SessionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkApprovalRules");

            migrationBuilder.DropTable(
                name: "WorkCheckpointFiles");

            migrationBuilder.DropTable(
                name: "WorkCheckpoints");

            migrationBuilder.DropColumn(
                name: "PermissionMode",
                table: "WorkSessions");
        }
    }
}
