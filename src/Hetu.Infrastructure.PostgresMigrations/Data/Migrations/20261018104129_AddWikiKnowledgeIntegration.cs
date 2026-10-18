using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWikiKnowledgeIntegration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "WikiDocumentId",
                table: "KnowledgeItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceWikiDocumentId",
                table: "GraphRelations",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_KnowledgeItems_WikiDocumentId",
                table: "KnowledgeItems",
                column: "WikiDocumentId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GraphRelations_SourceWikiDocumentId",
                table: "GraphRelations",
                column: "SourceWikiDocumentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_KnowledgeItems_WikiDocumentId",
                table: "KnowledgeItems");

            migrationBuilder.DropIndex(
                name: "IX_GraphRelations_SourceWikiDocumentId",
                table: "GraphRelations");

            migrationBuilder.DropColumn(
                name: "WikiDocumentId",
                table: "KnowledgeItems");

            migrationBuilder.DropColumn(
                name: "SourceWikiDocumentId",
                table: "GraphRelations");
        }
    }
}
