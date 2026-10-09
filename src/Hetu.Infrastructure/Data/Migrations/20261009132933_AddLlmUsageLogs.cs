using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLlmUsageLogs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LlmUsageLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Source = table.Column<string>(type: "TEXT", nullable: false),
                    RefId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ModelId = table.Column<Guid>(type: "TEXT", nullable: true),
                    InputTokens = table.Column<int>(type: "INTEGER", nullable: true),
                    CompressedTokens = table.Column<int>(type: "INTEGER", nullable: true),
                    OutputTokens = table.Column<int>(type: "INTEGER", nullable: true),
                    TokensUsed = table.Column<int>(type: "INTEGER", nullable: true),
                    CachedTokens = table.Column<int>(type: "INTEGER", nullable: true),
                    LatencyMs = table.Column<int>(type: "INTEGER", nullable: true),
                    ContentPreview = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LlmUsageLogs", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LlmUsageLogs");
        }
    }
}
