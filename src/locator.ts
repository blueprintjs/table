/*
 * Copyright 2016 Palantir Technologies, Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as Classes from "./common/classes";
import { Grid } from "./common/grid";
import { Rect } from "./common/rect";
import { Utils } from "./common/utils";

export interface Locator {
    /**
     * Returns the width that a column must be to contain all the content of
     * its cells without truncating or wrapping.
     */
    getWidestVisibleCellInColumn: (columnIndex: number) => number;

    /**
     * Gets the viewport rect.
     */
    getViewportRect(): Rect;

    /**
     * Returns the height of the tallest cell in a given column -- specifically,
     * tallest as in how tall the cell would have to be to display all the content in it
     */
    getTallestVisibleCellInColumn: (columnIndex: number) => number;

    /**
     * Locates a column's index given the client X coordinate. Returns -1 if
     * the coordinate is not over a column.
     * If `useMidpoint` is `true`, returns the index of the column whose left
     * edge is closest, splitting on the midpoint of each column.
     */
    convertPointToColumn: (clientX: number, useMidpoint?: boolean) => number;

    /**
     * Locates a row's index given the client Y coordinate. Returns -1 if
     * the coordinate is not over a row.
     * If `useMidpoint` is `true`, returns the index of the row whose top
     * edge is closest, splitting on the midpoint of each row.
     */
    convertPointToRow: (clientY: number, useMidpoint?: boolean) => number;

    /**
     * Locates a cell's row and column index given the client X and Y
     * coordinates.
     */
    convertPointToCell: (clientX: number, clientY: number) => { col: number; row: number };

    /**
     * Updates the grid.
     */
    setGrid(grid: Grid): this;

    setNumFrozenRows(numFrozenRows: number): this;

    setNumFrozenColumns(numFrozenColumns: number): this;

    /**
     * @returns whether the rendered rows overflow the visible viewport vertically, helpful for scrolling calculations
     */
    hasVerticalOverflowOrExactFit(columnHeaderHeight: number, viewportRect: Rect): boolean;

    /**
     * @returns whether the rendered columns overflow the visible viewport horizontally, helpful for scrolling calculations
     */
    hasHorizontalOverflowOrExactFit(rowHeaderWidth: number, viewportRect: Rect): boolean;
}

export class LocatorImpl implements Locator {
    public static CELL_HORIZONTAL_PADDING = 10;

    private grid: Grid | undefined;

    // these values affect how we map a mouse coordinate to a cell coordinate.
    // for instance, a click at (0px,0px) in the grid could map to an arbitrary
    // cell if table is scrolled, but it will always map to cell (0,0) if there
    // are active frozen rows and columns.
    private numFrozenRows: number;

    private numFrozenColumns: number;

    public constructor(
        /* The root table element within which a click is deemed valid and relevant. */
        private tableElement: HTMLElement,
        /* The scrollable element that wraps the cell container. */
        private scrollContainerElement: HTMLElement,
        /* The element containing all body cells in the grid (excluding headers). */
        private cellContainerElement: HTMLElement,
    ) {
        this.numFrozenRows = 0;
        this.numFrozenColumns = 0;
    }

    // Setters
    // =======

    public setGrid(grid: Grid) {
        this.grid = grid;
        return this;
    }

    public setNumFrozenRows(numFrozenRows: number) {
        this.numFrozenRows = numFrozenRows;
        return this;
    }

    public setNumFrozenColumns(numFrozenColumns: number) {
        this.numFrozenColumns = numFrozenColumns;
        return this;
    }

    // Getters
    // =======

    public getViewportRect() {
        return new Rect(
            this.scrollContainerElement.scrollLeft || 0,
            this.scrollContainerElement.scrollTop || 0,
            this.scrollContainerElement.clientWidth,
            this.scrollContainerElement.clientHeight,
        );
    }

    public getWidestVisibleCellInColumn(columnIndex: number): number {
        const columnCellSelector = this.getColumnCellSelector(columnIndex);
        const columnHeaderAndBodyCells = this.tableElement.querySelectorAll(columnCellSelector);

        let maxWidth = 0;
        for (let i = 0; i < columnHeaderAndBodyCells.length; i++) {
            const contentWidth = Utils.measureElementTextContent(columnHeaderAndBodyCells.item(i)).width;
            const cellWidth = Math.ceil(contentWidth) + LocatorImpl.CELL_HORIZONTAL_PADDING * 2;
            if (cellWidth > maxWidth) {
                maxWidth = cellWidth;
            }
        }
        return maxWidth;
    }

    public getTallestVisibleCellInColumn(columnIndex: number): number {
        // consider only body cells, hence the extra Classes.TABLE_CELL specificity
        const columnCellSelector = this.getColumnCellSelector(columnIndex);
        const columnBodyCells = this.tableElement.querySelectorAll(`${columnCellSelector}.${Classes.TABLE_CELL}`);

        let maxHeight = 0;
        for (let i = 0; i < columnBodyCells.length; i++) {
            const cell = columnBodyCells.item(i);

            const cellValue = cell.querySelector(`.${Classes.TABLE_TRUNCATED_VALUE}`);
            const cellTruncatedFormatText = cell.querySelector(`.${Classes.TABLE_TRUNCATED_FORMAT_TEXT}`);
            const cellTruncatedText = cell.querySelector(`.${Classes.TABLE_TRUNCATED_TEXT}`);

            let height = 0;

            if (cellValue != null) {
                height = cellValue.scrollHeight;
            } else if (cellTruncatedFormatText != null) {
                height = cellTruncatedFormatText.scrollHeight;
            } else if (cellTruncatedText != null) {
                height = cellTruncatedText.scrollHeight;
            } else {
                // it's not anything we recognize, just use the current height of the cell
                height = cell.scrollHeight;
            }

            if (height > maxHeight) {
                maxHeight = height;
            }
        }
        return maxHeight;
    }

    /**
     * Pass in an already-computed viewport rect here, if available, to reduce DOM reads.
     *
     * @returns whether the rendered rows overflow or exactly fit the visible viewport vertically, helpful for scrolling calculations
     */
    public hasVerticalOverflowOrExactFit(
        columnHeaderHeight = Grid.MIN_COLUMN_HEADER_HEIGHT,
        viewportRect = this.getViewportRect(),
    ) {
        if (this.grid === undefined) {
            return false;
        }
        return this.grid.getHeight() >= viewportRect.height - columnHeaderHeight;
    }

    /**
     * Pass in an already-computed viewport rect here, if available, to reduce DOM reads.
     *
     * @returns whether the rendered columns overflow or exactly fit the visible viewport horizontally, helpful for scrolling calculations
     */
    public hasHorizontalOverflowOrExactFit(
        rowHeaderWidth = Grid.MIN_ROW_HEADER_WIDTH,
        viewportRect = this.getViewportRect(),
    ) {
        if (this.grid === undefined) {
            return false;
        }
        return this.grid.getWidth() >= viewportRect.width - rowHeaderWidth;
    }

    // Converters
    // ==========

    public convertPointToColumn(clientX: number, useMidpoint?: boolean): number {
        const tableRect = this.getTableRect();
        if (this.grid === undefined || !tableRect.containsX(clientX)) {
            return -1;
        }
        const gridX = this.toGridX(clientX);
        const limit = useMidpoint ? this.grid.numCols : this.grid.numCols - 1;
        const lookupFn = useMidpoint ? this.convertCellMidpointToClientX : this.convertCellIndexToClientX;
        return Utils.binarySearch(gridX, limit, lookupFn);
    }

    public convertPointToRow(clientY: number, useMidpoint?: boolean): number {
        const tableRect = this.getTableRect();
        if (this.grid === undefined || !tableRect.containsY(clientY)) {
            return -1;
        }
        const gridY = this.toGridY(clientY);
        const limit = useMidpoint ? this.grid.numRows : this.grid.numRows - 1;
        const lookupFn = useMidpoint ? this.convertCellMidpointToClientY : this.convertCellIndexToClientY;
        return Utils.binarySearch(gridY, limit, lookupFn);
    }

    public convertPointToCell(clientX: number, clientY: number) {
        const gridX = this.toGridX(clientX);
        const gridY = this.toGridY(clientY);
        const col = Utils.binarySearch(gridX, this.grid!.numCols - 1, this.convertCellIndexToClientX);
        const row = Utils.binarySearch(gridY, this.grid!.numRows - 1, this.convertCellIndexToClientY);
        return { col, row };
    }

    // Private helpers
    // ===============

    private getColumnCellSelector(columnIndex: number) {
        // measure frozen columns in the LEFT quadrant; otherwise, they might
        // have been scrolled out of view, leading to wonky measurements (#1561)
        const isFrozenColumnIndex = columnIndex < this.numFrozenColumns;
        const quadrantClass = isFrozenColumnIndex ? Classes.TABLE_QUADRANT_LEFT : Classes.TABLE_QUADRANT_MAIN;
        const cellClass = Classes.columnCellIndexClass(columnIndex);
        return `.${quadrantClass} .${cellClass}`;
    }

    private getTableRect() {
        return Rect.wrap(this.tableElement.getBoundingClientRect());
    }

    private convertCellIndexToClientX = (index: number) => {
        return this.grid!.getCumulativeWidthAt(index);
    };

    private convertCellMidpointToClientX = (index: number) => {
        const cellLeft = this.grid!.getCumulativeWidthBefore(index);
        const cellRight = this.grid!.getCumulativeWidthAt(index);
        return (cellLeft + cellRight) / 2;
    };

    private convertCellIndexToClientY = (index: number) => {
        return this.grid!.getCumulativeHeightAt(index);
    };

    private convertCellMidpointToClientY = (index: number) => {
        const cellTop = this.grid!.getCumulativeHeightBefore(index);
        const cellBottom = this.grid!.getCumulativeHeightAt(index);
        return (cellTop + cellBottom) / 2;
    };

    private toGridX = (clientX: number) => {
        const gridOffsetFromPageLeft = this.cellContainerElement.getBoundingClientRect().left;
        const scrollOffsetFromGridLeft = this.scrollContainerElement.scrollLeft;
        const cursorOffsetFromGridLeft = clientX - (gridOffsetFromPageLeft + scrollOffsetFromGridLeft);

        const isCursorWithinFrozenColumns =
            this.numFrozenColumns != null &&
            this.numFrozenColumns > 0 &&
            cursorOffsetFromGridLeft <= this.grid!.getCumulativeWidthBefore(this.numFrozenColumns);

        // the frozen-column region doesn't scroll, so ignore the scroll distance in that case
        return isCursorWithinFrozenColumns
            ? cursorOffsetFromGridLeft
            : cursorOffsetFromGridLeft + scrollOffsetFromGridLeft;
    };

    private toGridY = (clientY: number) => {
        const gridOffsetFromPageTop = this.cellContainerElement.getBoundingClientRect().top;
        const scrollOffsetFromGridTop = this.scrollContainerElement.scrollTop;
        const cursorOffsetFromGridTop = clientY - (gridOffsetFromPageTop + scrollOffsetFromGridTop);

        const isCursorWithinFrozenRows =
            this.numFrozenRows != null &&
            this.numFrozenRows > 0 &&
            cursorOffsetFromGridTop <= this.grid!.getCumulativeHeightBefore(this.numFrozenRows);

        return isCursorWithinFrozenRows ? cursorOffsetFromGridTop : cursorOffsetFromGridTop + scrollOffsetFromGridTop;
    };
}
