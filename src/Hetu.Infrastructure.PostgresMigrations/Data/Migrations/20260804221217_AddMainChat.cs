using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMainChat : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsMain",
                table: "ChatTopics",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "CachedTokens",
                table: "ChatMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CompressedTokens",
                table: "ChatMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "InputTokens",
                table: "ChatMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OutputTokens",
                table: "ChatMessages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsMain",
                table: "ChatGroups",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsMain",
                table: "ChatTopics");

            migrationBuilder.DropColumn(
                name: "CachedTokens",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "CompressedTokens",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "InputTokens",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "OutputTokens",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "IsMain",
                table: "ChatGroups");
        }
    }
}
