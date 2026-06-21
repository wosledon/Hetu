using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveTopicContextWindowSize : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 迁移：取第一个非空 ContextWindowSize 作为全局设置
            migrationBuilder.Sql(@"
                INSERT OR IGNORE INTO AppSettings (Key, Value)
                SELECT 'ContextWindowSize', CAST(ContextWindowSize AS TEXT)
                FROM ChatTopics
                WHERE ContextWindowSize IS NOT NULL
                LIMIT 1
            ");

            migrationBuilder.DropColumn(
                name: "ContextWindowSize",
                table: "ChatTopics");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ContextWindowSize",
                table: "ChatTopics",
                type: "INTEGER",
                nullable: true);
        }
    }
}
