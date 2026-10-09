using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWikiDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "KanbanTaskRunSteps",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    RunId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Content = table.Column<string>(type: "text", nullable: false),
                    IsError = table.Column<bool>(type: "boolean", nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KanbanTaskRunSteps", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WikiDocuments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WikiDocuments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WikiDocuments_ManagedProjects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "ManagedProjects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTaskRunSteps_RunId",
                table: "KanbanTaskRunSteps",
                column: "RunId");

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTaskRunSteps_Sequence",
                table: "KanbanTaskRunSteps",
                column: "Sequence");

            migrationBuilder.CreateIndex(
                name: "IX_KanbanTaskRunSteps_TaskId",
                table: "KanbanTaskRunSteps",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_WikiDocuments_CreatedAt",
                table: "WikiDocuments",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_WikiDocuments_ProjectId",
                table: "WikiDocuments",
                column: "ProjectId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "KanbanTaskRunSteps");

            migrationBuilder.DropTable(
                name: "WikiDocuments");
        }
    }
}
