using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
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
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    FilePath = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    OldContent = table.Column<string>(type: "text", nullable: true),
                    NewContent = table.Column<string>(type: "text", nullable: false),
                    Action = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
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
