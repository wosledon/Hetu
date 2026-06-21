using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddGraphRelationSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeletedAt",
                table: "GraphRelations",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDeleted",
                table: "GraphRelations",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_GraphRelations_IsDeleted",
                table: "GraphRelations",
                column: "IsDeleted");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_GraphRelations_IsDeleted",
                table: "GraphRelations");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "GraphRelations");

            migrationBuilder.DropColumn(
                name: "IsDeleted",
                table: "GraphRelations");
        }
    }
}
