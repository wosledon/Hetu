using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWikiSet : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SetId",
                table: "WikiDocuments",
                type: "TEXT",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "WikiDocuments",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            // 存量单篇文档各自成组：SetId 为空 GUID 时取自身 Id
            migrationBuilder.Sql("UPDATE WikiDocuments SET SetId = Id WHERE SetId = '00000000-0000-0000-0000-000000000000'");

            migrationBuilder.CreateIndex(
                name: "IX_WikiDocuments_SetId",
                table: "WikiDocuments",
                column: "SetId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_WikiDocuments_SetId",
                table: "WikiDocuments");

            migrationBuilder.DropColumn(
                name: "SetId",
                table: "WikiDocuments");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "WikiDocuments");
        }
    }
}
