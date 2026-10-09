using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class WikiGenerationJobs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Brief",
                table: "WikiDocuments",
                type: "TEXT",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WikiGenerationJobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    Stage = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Progress = table.Column<int>(type: "INTEGER", nullable: false),
                    TotalPages = table.Column<int>(type: "INTEGER", nullable: false),
                    DonePages = table.Column<int>(type: "INTEGER", nullable: false),
                    ErrorMessage = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    ModelId = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    SetId = table.Column<Guid>(type: "TEXT", nullable: true),
                    CompletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WikiGenerationJobs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WikiGenerationJobs_ManagedProjects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "ManagedProjects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WikiGenerationJobs_CreatedAt",
                table: "WikiGenerationJobs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_WikiGenerationJobs_ProjectId",
                table: "WikiGenerationJobs",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_WikiGenerationJobs_Status",
                table: "WikiGenerationJobs",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WikiGenerationJobs");

            migrationBuilder.DropColumn(
                name: "Brief",
                table: "WikiDocuments");
        }
    }
}
