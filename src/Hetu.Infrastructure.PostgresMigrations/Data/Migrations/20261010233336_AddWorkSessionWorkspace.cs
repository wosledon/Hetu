using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkSessionWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Branch",
                table: "WorkSessions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorktreePath",
                table: "WorkSessions",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Branch",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "WorktreePath",
                table: "WorkSessions");
        }
    }
}
