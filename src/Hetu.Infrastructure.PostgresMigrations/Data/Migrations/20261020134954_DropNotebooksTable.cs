using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class DropNotebooksTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 单独一个迁移：与 SQLite 保持对称的结构；前一个迁移已把 Notes 的
            // NotebookId 外键换成自引用 ParentId，这里删表才安全。
            //
            // Notebooks 自身有 RESTRICT 自引用外键，DROP TABLE 的隐式 DELETE 会撞上它：
            // 先逐层删除「叶子」行（重复多遍以覆盖任意深度），再删根行，最后删表。
            for (var i = 0; i < 5; i++)
            {
                migrationBuilder.Sql("""
                    DELETE FROM "Notebooks"
                    WHERE "ParentId" IS NOT NULL
                      AND "Id" NOT IN (SELECT "ParentId" FROM "Notebooks" WHERE "ParentId" IS NOT NULL");
                    """);
            }
            migrationBuilder.Sql("""DELETE FROM "Notebooks";""");

            migrationBuilder.DropTable(
                name: "Notebooks");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Notebooks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notebooks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Notebooks_Notebooks_ParentId",
                        column: x => x.ParentId,
                        principalTable: "Notebooks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Notebooks_ParentId",
                table: "Notebooks",
                column: "ParentId");
        }
    }
}
