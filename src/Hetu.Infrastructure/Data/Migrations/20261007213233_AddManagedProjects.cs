using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddManagedProjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProjectGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ManagedProjects",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    ProjectType = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false, defaultValue: "Local"),
                    DirectoryPath = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false),
                    SshHost = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    SshPort = table.Column<int>(type: "INTEGER", nullable: false),
                    SshUser = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    SshAuthType = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false, defaultValue: "Key"),
                    SshKeyPath = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    SshPasswordProtected = table.Column<string>(type: "TEXT", maxLength: 4000, nullable: true),
                    GroupId = table.Column<Guid>(type: "TEXT", nullable: true),
                    Category = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    Tags = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    IsPinned = table.Column<bool>(type: "INTEGER", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false),
                    LastOpenedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ManagedProjects", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ManagedProjects_ProjectGroups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "ProjectGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ManagedProjects_Category",
                table: "ManagedProjects",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_ManagedProjects_GroupId",
                table: "ManagedProjects",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_ManagedProjects_IsPinned",
                table: "ManagedProjects",
                column: "IsPinned");

            migrationBuilder.CreateIndex(
                name: "IX_ManagedProjects_SortOrder",
                table: "ManagedProjects",
                column: "SortOrder");

            migrationBuilder.CreateIndex(
                name: "IX_ProjectGroups_SortOrder",
                table: "ProjectGroups",
                column: "SortOrder");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ManagedProjects");

            migrationBuilder.DropTable(
                name: "ProjectGroups");
        }
    }
}
