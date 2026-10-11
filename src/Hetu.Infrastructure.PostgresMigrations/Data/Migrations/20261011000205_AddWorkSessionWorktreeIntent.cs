using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkSessionWorktreeIntent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BaseBranch",
                table: "WorkSessions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "UseWorktree",
                table: "WorkSessions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BaseBranch",
                table: "WorkSessions");

            migrationBuilder.DropColumn(
                name: "UseWorktree",
                table: "WorkSessions");
        }
    }
}
