using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveNotebooksAddNestedNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Notes_Notebooks_NotebookId",
                table: "Notes");

            migrationBuilder.RenameColumn(
                name: "NotebookId",
                table: "Notes",
                newName: "ParentId");

            migrationBuilder.RenameIndex(
                name: "IX_Notes_NotebookId",
                table: "Notes",
                newName: "IX_Notes_ParentId");

            migrationBuilder.AddColumn<string>(
                name: "Icon",
                table: "Notes",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            // 数据迁移：笔记本整体转换为笔记（保留 Id，父子关系随之映射到笔记父子），
            // 笔记本内的笔记 ParentId 已指向笔记本 Id，转换后自然挂到对应笔记下
            migrationBuilder.Sql("""
                INSERT INTO "Notes" ("Id", "Title", "Content", "ParentId", "Icon", "IsDeleted", "DeletedAt", "IsFavorite", "IsPinned", "CreatedAt", "UpdatedAt")
                SELECT "Id", "Name", '', NULL, NULL, FALSE, NULL, FALSE, FALSE, "CreatedAt", "UpdatedAt" FROM "Notebooks";
                """);

            // 子笔记本转换成的笔记：ParentId 重映射为其父笔记本（同为转换后的笔记）
            migrationBuilder.Sql("""
                UPDATE "Notes" SET "ParentId" = (
                    SELECT nb."ParentId" FROM "Notebooks" nb WHERE nb."Id" = "Notes"."Id"
                )
                WHERE "Id" IN (SELECT "Id" FROM "Notebooks");
                """);

            migrationBuilder.DropColumn(
                name: "AutoOrganizeNotebookId",
                table: "ChatTopics");

            migrationBuilder.DropColumn(
                name: "IsAutoOrganizeEnabled",
                table: "ChatTopics");

            migrationBuilder.AddForeignKey(
                name: "FK_Notes_Notes_ParentId",
                table: "Notes",
                column: "ParentId",
                principalTable: "Notes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // 注意：由笔记本转换来的笔记无法还原为笔记本（内容已合并），Down 有损：
            // 仅恢复表结构与列，笔记树保留为笔记
            migrationBuilder.DropForeignKey(
                name: "FK_Notes_Notes_ParentId",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "Icon",
                table: "Notes");

            migrationBuilder.RenameColumn(
                name: "ParentId",
                table: "Notes",
                newName: "NotebookId");

            migrationBuilder.RenameIndex(
                name: "IX_Notes_ParentId",
                table: "Notes",
                newName: "IX_Notes_NotebookId");

            migrationBuilder.AddColumn<Guid>(
                name: "AutoOrganizeNotebookId",
                table: "ChatTopics",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAutoOrganizeEnabled",
                table: "ChatTopics",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
