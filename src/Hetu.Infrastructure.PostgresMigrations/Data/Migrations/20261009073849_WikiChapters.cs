using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class WikiChapters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "WarningMessage",
                table: "WikiGenerationJobs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Chapter",
                table: "WikiDocuments",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WarningMessage",
                table: "WikiGenerationJobs");

            migrationBuilder.DropColumn(
                name: "Chapter",
                table: "WikiDocuments");
        }
    }
}
