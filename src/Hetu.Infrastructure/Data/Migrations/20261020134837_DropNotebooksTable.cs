using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class DropNotebooksTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 单独一个迁移：SQLite 的 EF provider 对 Notes 表的重建是延迟到迁移末尾的，
            // 同一迁移内 DROP TABLE Notebooks 会因旧外键仍生效而失败（FOREIGN KEY constraint failed）。
            // 前一个迁移已完成 Notes 重建（外键已换成自引用），这里删表才安全。
            //
            // Notebooks 自身有 RESTRICT 自引用外键，DROP TABLE 的隐式 DELETE 会撞上它：
            // 先逐层删除「叶子」行（重复多遍以覆盖任意深度），再删根行，最后删表。
            for (var i = 0; i < 5; i++)
            {
                migrationBuilder.Sql("""
                    DELETE FROM "Notebooks"
                    WHERE "ParentId" IS NOT NULL
                      AND "Id" NOT IN (SELECT "ParentId" FROM "Notebooks" WHERE "ParentId" IS NOT NULL);
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
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ParentId = table.Column<Guid>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
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
