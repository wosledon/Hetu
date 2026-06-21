using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddChatMessageThinkingAndSearch : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SearchResultsJson",
                table: "ChatMessages",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ThinkingContent",
                table: "ChatMessages",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SearchResultsJson",
                table: "ChatMessages");

            migrationBuilder.DropColumn(
                name: "ThinkingContent",
                table: "ChatMessages");
        }
    }
}
