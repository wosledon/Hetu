using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class LinkWorkProjectToManagedProject : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ManagedProjectId",
                table: "WorkProjects",
                type: "uuid",
                nullable: true);

            // 存量数据互通：把尚未登记到项目管理的 Code 项目补登为受管项目
            migrationBuilder.Sql(
                "INSERT INTO \"ManagedProjects\" (\"Id\", \"Name\", \"Description\", \"ProjectType\", \"DirectoryPath\", \"SshHost\", \"SshPort\", \"SshUser\", \"SshAuthType\", \"SshKeyPath\", \"SshPasswordProtected\", \"GroupId\", \"Category\", \"Tags\", \"IsPinned\", \"SortOrder\", \"LastOpenedAt\", \"CreatedAt\", \"UpdatedAt\") " +
                "SELECT gen_random_uuid(), w.\"Name\", w.\"Description\", w.\"ConnectionType\", w.\"RootPath\", w.\"SshHost\", w.\"SshPort\", w.\"SshUser\", w.\"SshAuthType\", w.\"SshKeyPath\", w.\"SshPasswordProtected\", NULL, NULL, NULL, FALSE, w.\"SortOrder\", NULL, w.\"CreatedAt\", w.\"UpdatedAt\" " +
                "FROM \"WorkProjects\" w " +
                "WHERE w.\"ManagedProjectId\" IS NULL " +
                "AND NOT EXISTS (SELECT 1 FROM \"ManagedProjects\" m WHERE m.\"DirectoryPath\" = w.\"RootPath\");");

            // 再按目录路径对齐，让既有项目在两侧立即互通
            migrationBuilder.Sql(
                "UPDATE \"WorkProjects\" SET \"ManagedProjectId\" = (" +
                "SELECT m.\"Id\" FROM \"ManagedProjects\" m WHERE m.\"DirectoryPath\" = \"WorkProjects\".\"RootPath\" LIMIT 1) " +
                "WHERE \"ManagedProjectId\" IS NULL " +
                "AND EXISTS (SELECT 1 FROM \"ManagedProjects\" m WHERE m.\"DirectoryPath\" = \"WorkProjects\".\"RootPath\");");

            migrationBuilder.CreateIndex(
                name: "IX_WorkProjects_ManagedProjectId",
                table: "WorkProjects",
                column: "ManagedProjectId");

            migrationBuilder.AddForeignKey(
                name: "FK_WorkProjects_ManagedProjects_ManagedProjectId",
                table: "WorkProjects",
                column: "ManagedProjectId",
                principalTable: "ManagedProjects",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_WorkProjects_ManagedProjects_ManagedProjectId",
                table: "WorkProjects");

            migrationBuilder.DropIndex(
                name: "IX_WorkProjects_ManagedProjectId",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "ManagedProjectId",
                table: "WorkProjects");
        }
    }
}
