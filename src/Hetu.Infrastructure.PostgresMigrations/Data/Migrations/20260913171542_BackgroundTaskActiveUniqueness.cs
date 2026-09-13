using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class BackgroundTaskActiveUniqueness : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 先清理历史并发入队产生的重复活跃记录，否则唯一索引无法创建
            migrationBuilder.Sql("""
                UPDATE "TaskItems" AS t
                SET "Status" = 3,
                    "ErrorMessage" = '重复的排队任务记录，已自动清理'
                WHERE t."Id" IN (
                    SELECT "Id" FROM (
                        SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "TaskType", "EntityId" ORDER BY "CreatedAt" DESC) AS rn
                        FROM "TaskItems"
                        WHERE "Status" IN (0, 1) AND "IsDeleted" = false
                    ) AS dup
                    WHERE dup.rn > 1
                );
                """);

            migrationBuilder.CreateIndex(
                name: "IX_TaskItems_ActiveUniqueness",
                table: "TaskItems",
                columns: new[] { "TaskType", "EntityId" },
                unique: true,
                filter: "\"Status\" IN (0, 1) AND \"IsDeleted\" = false");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TaskItems_ActiveUniqueness",
                table: "TaskItems");
        }
    }
}
