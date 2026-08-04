using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class FixWorkModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WorkFileChanges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SessionId = table.Column<Guid>(type: "TEXT", nullable: true),
                    FilePath = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false),
                    OldContent = table.Column<string>(type: "TEXT", nullable: true),
                    NewContent = table.Column<string>(type: "TEXT", nullable: false),
                    Action = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkFileChanges", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkFileChanges_CreatedAt",
                table: "WorkFileChanges",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_WorkFileChanges_ProjectId",
                table: "WorkFileChanges",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkFileChanges_SessionId",
                table: "WorkFileChanges",
                column: "SessionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkFileChanges");
        }
    }
}
