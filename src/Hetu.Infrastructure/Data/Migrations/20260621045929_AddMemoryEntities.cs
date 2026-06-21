using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMemoryEntities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Memories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    Source = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    TopicId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Category = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    Importance = table.Column<float>(type: "REAL", nullable: false),
                    LastAccessedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    AccessCount = table.Column<int>(type: "INTEGER", nullable: false),
                    IsDeleted = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Memories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MemoryEmbeddings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    MemoryId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    Embedding = table.Column<byte[]>(type: "BLOB", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MemoryEmbeddings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MemoryEmbeddings_Memories_MemoryId",
                        column: x => x.MemoryId,
                        principalTable: "Memories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Memories_Category",
                table: "Memories",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_Importance",
                table: "Memories",
                column: "Importance");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_IsDeleted",
                table: "Memories",
                column: "IsDeleted");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_LastAccessedAt",
                table: "Memories",
                column: "LastAccessedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Memories_Source",
                table: "Memories",
                column: "Source");

            migrationBuilder.CreateIndex(
                name: "IX_MemoryEmbeddings_MemoryId",
                table: "MemoryEmbeddings",
                column: "MemoryId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MemoryEmbeddings");

            migrationBuilder.DropTable(
                name: "Memories");
        }
    }
}
